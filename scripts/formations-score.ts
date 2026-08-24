import "./_bootstrap";
import { readFileSync, writeFileSync } from "fs";
import { getAnthropic, HAIKU } from "../lib/anthropic";
import { assertBudget, BudgetExceededError, logSummary, record, spentUsd } from "../lib/cost";
import { FUND } from "../lib/fund";
import { loadCandidates } from "../lib/store";
import type { Formation } from "../lib/formations";
import type { Candidate } from "../lib/types";

// Triage pass over the Companies House shortlist.
//
// Deliberately NOT a durability score. A company incorporated three months ago
// has no public product, no customers and no revenue, so scoring it on
// switching cost or compounding data would be inventing facts. What is actually
// decidable from a name, SIC codes, director history and the director's public
// GitHub is: is this a real venture or a consultancy shell, what does it most
// likely do, and is it worth a call now or a watch.

const IN = process.env.CH_OUT ?? ".data/formations.json";
const OUT = process.env.CH_SCORED_OUT ?? ".data/formations-scored.json";
const TOP_N = Number(process.env.CH_SCORE_TOP ?? 150);
const MIN_SCORE = Number(process.env.CH_SCORE_MIN ?? 3);

const SYSTEM = `You are a sourcing analyst at ${FUND.name}, an early-stage venture fund in ${FUND.hq}. You are triaging newly incorporated UK companies pulled from the Companies House register, before any of them have announced anything.

You get very little: a company name, SIC codes, incorporation date, registered city, director names, the directors' prior directorships, and — when the company was surfaced because one of its directors is already on our GitHub talent radar — that person's public developer profile.

That is genuinely thin. Do not pretend otherwise. Your job is triage, not valuation:

- venture_likelihood (1-10): how likely is this a real venture-track technology company rather than a consultancy, a contractor's personal service company, a holding vehicle, or a side project? A lone director with a generic name and no prior directorships filing under 62020 is almost always a contractor shell. A recognised AI builder incorporating with a co-founder is not.
- likely_focus: one short line on what the company most plausibly does. Say "unclear" if the name and SIC codes genuinely do not support a guess. Never invent a product.
- why_interesting: at most 2 short lines, citing only the concrete facts you were given. If the only interesting thing is the person, say that.
- recommended_action: exactly one of "reach out", "watch", or "ignore".
- confidence: 1-10, how much the available evidence supports your read. Be honest and use the low end — most of these rows are thin by nature.

Never state a product, customer, revenue figure or funding event that is not in the input. Absence of evidence is a finding; report it as such.`;

const TOOL = {
  name: "record_triage",
  description: "Record the triage assessment for one newly incorporated company.",
  input_schema: {
    type: "object" as const,
    properties: {
      venture_likelihood: { type: "integer", minimum: 1, maximum: 10 },
      likely_focus: { type: "string", description: "One short line, or 'unclear'." },
      why_interesting: { type: "string", description: "At most 2 short lines. Concrete facts only." },
      recommended_action: { type: "string", enum: ["reach out", "watch", "ignore"] },
      confidence: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["venture_likelihood", "likely_focus", "why_interesting", "recommended_action", "confidence"],
  },
};

interface Triage {
  venture_likelihood: number;
  likely_focus: string;
  why_interesting: string;
  recommended_action: string;
  confidence: number;
}

function block(f: Formation, c: Candidate | undefined): string {
  const lines = [
    `Company: ${f.company_name}`,
    `Company number: ${f.company_number}`,
    `Incorporated: ${f.incorporated_on} (${f.months_old} months ago)`,
    `SIC codes: ${f.sic_codes.join(", ") || "none filed"}`,
    `Registered city: ${f.hq_city ?? "unknown"}${f.postcode ? ` (${f.postcode})` : ""}`,
    `Active directors: ${f.officers.join("; ") || "none listed"}`,
    `Prior directorships of first director: ${f.prior_companies.join("; ") || "none"}`,
    `Share allotment (SH01) filed: ${f.has_share_allotment ? "yes" : "no"}`,
    `Register signals: ${f.signals.join("; ")}`,
  ];
  if (c) {
    const repos = (c.top_repos ?? []).slice(0, 6)
      .map((r) => `${r.name} (${r.language ?? "?"}, ${r.stars}*): ${r.description ?? ""}`)
      .join(" | ");
    lines.push(
      "",
      `A director is on our GitHub talent radar:`,
      `  github.com/${c.github_login}${c.name ? ` (${c.name})` : ""} — talent-radar fit ${c.fit_score ?? "?"}`,
      `  Bio: ${c.bio ?? "none"}`,
      `  Stated company: ${c.company ?? "none"}`,
      `  Location: ${c.location ?? "unknown"}`,
      `  AI repos starred: ${c.starred_ai_count} total, ${c.starred_ai_30d} in the last 30 days`,
      `  Top repos: ${repos || "none"}`,
      `  Radar signals: ${(c.signals ?? []).join("; ") || "none"}`,
    );
  }
  return lines.join("\n");
}

async function triage(f: Formation, c: Candidate | undefined): Promise<Triage> {
  assertBudget();
  const anthropic = getAnthropic();
  const msg = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 600,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_triage" },
    messages: [{ role: "user", content: block(f, c) }],
  });
  record(HAIKU, msg.usage);
  const use = msg.content.find((b) => b.type === "tool_use");
  if (!use || use.type !== "tool_use") throw new Error("no tool_use in response");
  return use.input as Triage;
}

async function main() {
  let payload: { formations: Formation[] };
  try {
    payload = JSON.parse(readFileSync(IN, "utf8"));
  } catch {
    console.error(`No shortlist at ${IN}. Run \`npm run formations\` first.`);
    process.exit(1);
  }

  const candidates = await loadCandidates();
  const byLogin = new Map(candidates.map((c) => [c.github_login, c]));

  const shortlist = payload.formations
    .filter((f) => f.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  console.log(
    `[triage] ${payload.formations.length} formations -> ${shortlist.length} above pre-score ${MIN_SCORE} (cap ${TOP_N})`,
  );
  if (payload.formations.length > shortlist.length) {
    console.log(`[triage] ${payload.formations.length - shortlist.length} below the bar were not scored`);
  }

  const out: (Formation & { triage: Triage })[] = [];
  let failed = 0;
  for (const [i, f] of shortlist.entries()) {
    try {
      const t = await triage(f, f.matched_candidate ? byLogin.get(f.matched_candidate) : undefined);
      out.push({ ...f, triage: t });
      if ((i + 1) % 20 === 0) console.log(`[triage] ${i + 1}/${shortlist.length}, $${spentUsd().toFixed(3)}`);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        console.error(`[triage] ABORTED — ${e.message}`);
        break;
      }
      failed++;
      console.error(`[triage] ${f.company_name}: ${(e as Error).message}`);
    }
  }

  out.sort(
    (a, b) =>
      b.triage.venture_likelihood * b.score - a.triage.venture_likelihood * a.score,
  );
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), count: out.length, formations: out }, null, 2));

  const reach = out.filter((f) => f.triage.recommended_action === "reach out");
  console.log(`\n[triage] ${out.length} triaged (${failed} failed) -> ${OUT}`);
  console.log(`[triage] ${reach.length} marked "reach out":`);
  for (const f of reach.slice(0, 15)) {
    console.log(`[triage]   ${f.company_name} (${f.months_old}mo, ${f.hq_city ?? "?"}) — ${f.triage.likely_focus}`);
    console.log(`[triage]     ${f.triage.why_interesting.replace(/\n/g, " ")}`);
  }
  logSummary();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
