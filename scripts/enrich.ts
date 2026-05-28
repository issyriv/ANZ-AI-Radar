import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import { getAnthropic, HAIKU } from "../lib/anthropic";
import { AIRTREE_ALUMNI } from "../lib/config";
import type { Candidate, EnrichmentResult, RepoSummary, StarredRepoSummary } from "../lib/types";

const FORCE = process.argv.includes("--force") || process.env.ENRICH_FORCE === "1";
const LIMIT = process.env.ENRICH_LIMIT ? Number(process.env.ENRICH_LIMIT) : undefined;
const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 3);

const ALUMNI_NAMES = AIRTREE_ALUMNI.map((a) => a.name);

const SYSTEM = `You are a sourcing analyst for Airtree, an early-stage venture capital firm in Sydney. Airtree backs technical founders building AI-native companies in Australia and New Zealand.

You are given one GitHub user's public footprint. Assess whether this person could found, or is about to found, an AI company — the kind of builder Airtree should reach out to early, before they announce.

fit_score (1-10) rubric:
- 9-10: strong founder signal — owns product-shaped AI repos (not just research/forks), recently very active, profile/bio suggests they are building something or recently left a role to do so.
- 7-8: serious AI builder; credible they could start a company soon.
- 4-6: clearly engaged with AI (contributes/stars) but more hobbyist, employee, or researcher signal than founder signal.
- 1-3: weak or incidental AI connection.

Signals to flag when present (short phrases, cite the concrete number/fact):
- rapid recent AI starring (e.g. "starred 28 AI repos in last 30 days")
- owns repos that look like a product, not research or coursework
- bio/company suggests they recently left a senior role, or says "building", "stealth", "founder", "ex-<company>"
- contributing to frontier AI infra (vllm, transformers, langchain, etc.)
- account/activity pattern suggesting building in stealth (e.g. lots of recent private-ish signal: high recent activity but few new public repos)

Airtree portfolio / alumni companies — flag in airtree_alumni_match if this person appears to be a current or former employee (from company field, bio, or email domain). Use these EXACT names: ${ALUMNI_NAMES.join(", ")}.

Be concise and specific. The summary must be exactly 2 short lines (max ~240 chars) and name concrete signals, not generic praise. Never invent facts not supported by the data.`;

const TOOL = {
  name: "record_assessment",
  description: "Record the VC sourcing assessment for this GitHub user.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "Exactly 2 short lines (~240 chars max). Why this person might interest an early-stage AI VC, citing concrete signals.",
      },
      fit_score: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Likelihood they could found / are about to found an AI company.",
      },
      signals: {
        type: "array",
        items: { type: "string" },
        description: "Short flagged signals, each citing a concrete fact. Empty array if none.",
      },
      airtree_alumni_match: {
        type: "array",
        items: { type: "string" },
        description: "Exact names from the provided alumni list this person is affiliated with, or empty array.",
      },
    },
    required: ["summary", "fit_score", "signals", "airtree_alumni_match"],
  },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
}

function buildUserBlock(c: Candidate): string {
  const repos = (c.top_repos as RepoSummary[]) ?? [];
  const stars = (c.starred_ai_sample as StarredRepoSummary[]) ?? [];
  const repoLines = repos
    .slice(0, 8)
    .map(
      (r) =>
        `- ${r.name} (${r.language ?? "?"}, ${r.stars}★, pushed ${fmtDate(r.pushed_at)}): ${r.description ?? ""}`,
    )
    .join("\n");
  const starLines = stars
    .slice(0, 12)
    .map((s) => `- ${s.full_name} (starred ${fmtDate(s.starred_at)}): ${s.description ?? ""}`)
    .join("\n");

  const accountAgeYears = c.account_created_at
    ? ((Date.now() - Date.parse(c.account_created_at)) / (365 * 86_400_000)).toFixed(1)
    : "?";

  return `GitHub: ${c.github_login}${c.name ? ` (${c.name})` : ""}
Location: ${c.location ?? "?"}
Company: ${c.company ?? "?"}
Bio: ${c.bio ?? "?"}
Email: ${c.email ?? "?"}  Website: ${c.blog ?? "?"}  Twitter: ${c.twitter_username ?? "?"}
Followers: ${c.followers} | Following: ${c.following} | Public repos: ${c.public_repos}
GitHub account age: ${accountAgeYears} yrs (created ${fmtDate(c.account_created_at)})
Most recent AI-relevant activity: ${fmtDate(c.last_ai_activity_at)}
AI repos starred (recent sample): ${c.starred_ai_count} total, ${c.starred_ai_30d} in the last 30 days
Contributed to frontier AI repos: ${(c.contributed_ai_repos ?? []).join(", ") || "none detected"}

Top owned repos:
${repoLines || "(none)"}

Recently starred AI repos:
${starLines || "(none)"}

Raw matched signals: ${(c.matched_signals ?? []).slice(0, 20).join("; ") || "none"}`;
}

// Deterministic alumni match against company/bio/email (reliable; unioned with model).
function deterministicAlumni(c: Candidate): string[] {
  const hay = `${c.company ?? ""} ${c.bio ?? ""} ${c.email ?? ""}`.toLowerCase();
  const out: string[] = [];
  for (const a of AIRTREE_ALUMNI) {
    if (a.aliases.some((alias) => hay.includes(alias.toLowerCase()))) out.push(a.name);
  }
  return out;
}

async function enrichOne(c: Candidate): Promise<EnrichmentResult> {
  const anthropic = getAnthropic();
  const msg = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 700,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_assessment" },
    messages: [{ role: "user", content: buildUserBlock(c) }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("no tool_use in response");
  }
  const input = toolUse.input as Partial<EnrichmentResult>;
  const fit = Math.max(1, Math.min(10, Math.round(Number(input.fit_score ?? 1))));
  return {
    summary: String(input.summary ?? "").trim(),
    fit_score: fit,
    signals: Array.isArray(input.signals) ? input.signals.map(String) : [],
    airtree_alumni_match: Array.isArray(input.airtree_alumni_match)
      ? input.airtree_alumni_match.map(String)
      : [],
  };
}

async function main() {
  const sb = getSupabaseAdmin();
  let q = sb.from("candidates").select("*").order("starred_ai_count", { ascending: false });
  if (!FORCE) q = q.is("enriched_at", null);
  if (LIMIT) q = q.limit(LIMIT);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const candidates = (data ?? []) as Candidate[];
  console.log(`[enrich] ${candidates.length} candidates to enrich (force=${FORCE}, concurrency=${CONCURRENCY})`);

  let done = 0;
  let failed = 0;

  async function worker(slice: Candidate[]) {
    for (const c of slice) {
      try {
        const res = await enrichOne(c);
        const alumni = Array.from(
          new Set([...res.airtree_alumni_match, ...deterministicAlumni(c)]),
        );
        const { error: upErr } = await sb
          .from("candidates")
          .update({
            enrichment_summary: res.summary,
            fit_score: res.fit_score,
            signals: res.signals,
            airtree_alumni_match: alumni,
            enrichment_model: HAIKU,
            enriched_at: new Date().toISOString(),
            enrichment_raw: res,
          })
          .eq("id", c.id);
        if (upErr) throw new Error(upErr.message);
        done++;
        if (done % 20 === 0) console.log(`[enrich] ${done}/${candidates.length} done`);
      } catch (e) {
        failed++;
        console.error(`[enrich] fail ${c.github_login}: ${(e as Error).message}`);
      }
    }
  }

  // Round-robin candidates across CONCURRENCY workers.
  const slices: Candidate[][] = Array.from({ length: CONCURRENCY }, () => []);
  candidates.forEach((c, i) => slices[i % CONCURRENCY].push(c));
  await Promise.all(slices.map(worker));

  console.log(`[enrich] DONE — ${done} enriched, ${failed} failed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
