import "./_bootstrap";
import { getAnthropic, HAIKU } from "../lib/anthropic";
import { assertBudget, BudgetExceededError, logSummary, record, spentUsd } from "../lib/cost";
import { loadCompanies, upsert } from "../lib/store";
import type { Company } from "../lib/types";

// Classify company maturity for SOURCING relevance.
//
// thesis_fit_score measures durability, and mature winners are maximally
// durable — Wise and Revolut correctly score 8-9 against the thesis. But a
// company worth billions is not actionable for an early-stage fund, and leaving
// those at the top of the ranking makes the tool useless for its actual job.
//
// The Companies House pass (scripts/funding.ts) settles this authoritatively via
// filed accounts type, but only for names that match the register unambiguously
// — which excludes exactly the famous, common names causing the problem. This
// fills the rest in.
//
// Deliberately a NARROW question: the model is told nothing about the fund, the
// thesis, or what we want the answer to be. It only reports size and status.

const BATCH = 30;
const APPLY = !process.argv.includes("--dry-run");

const SYSTEM = `You are given a list of company names, all UK-based or UK-active technology companies. For each, classify how mature the company is.

Use exactly one of these labels:
- "mature": widely known, publicly listed, acquired by a large company, or valued in the billions. Examples of this class: Wise, Revolut, Monzo, Deliveroo, Darktrace, Skyscanner, Arm, Ocado.
- "growing": an established private company, past Series A, with meaningful scale but not a household name.
- "early": pre-seed, seed, or Series A stage; small team; little or no public profile.
- "unknown": you do not recognise the company well enough to say. This is a perfectly good answer.

Rules:
- Judge the company's CURRENT size and profile, not its potential.
- If a name is generic or you cannot identify which company is meant, answer "unknown". Never guess.
- Return one entry per input name, using the name exactly as given.`;

const TOOL = {
  name: "record_maturity",
  input_schema: {
    type: "object" as const,
    properties: {
      companies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            maturity: { type: "string", enum: ["early", "growing", "mature", "unknown"] },
            confidence: { type: "integer", minimum: 1, maximum: 10 },
          },
          required: ["name", "maturity", "confidence"],
        },
      },
    },
    required: ["companies"],
  },
};

async function classify(names: string[]) {
  assertBudget();
  const msg = await getAnthropic().messages.create({
    model: HAIKU,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_maturity" },
    messages: [{ role: "user", content: names.map((n) => `- ${n}`).join("\n") }],
  });
  record(HAIKU, msg.usage);
  const use = msg.content.find((b) => b.type === "tool_use");
  if (!use || use.type !== "tool_use") return [];
  return (use.input as { companies?: { name: string; maturity: string; confidence: number }[] })
    .companies ?? [];
}

async function main() {
  const all = await loadCompanies();
  // The register is authoritative where it matched; only fill the gaps.
  const todo = all.filter((c: Company) => !c.maturity);
  console.log(`[maturity] ${todo.length} companies without a register-derived maturity`);

  const byName = new Map(todo.map((c) => [c.name, c]));
  const names = [...byName.keys()];
  const updates: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};

  for (let i = 0; i < names.length; i += BATCH) {
    try {
      const res = await classify(names.slice(i, i + BATCH));
      for (const r of res) {
        const c = byName.get(r.name);
        if (!c) continue;
        if (r.maturity === "unknown" || r.confidence < 6) continue;
        // A stage reported by a funding article outranks the model's guess about
        // a name. "Series A" and "mature" cannot both be true.
        const reportedEarly =
          c.stage_source === "reported" && /pre-?seed|seed|grant|series a/i.test(c.stage ?? "");
        if (r.maturity === "mature" && reportedEarly) {
          console.log(`[maturity] overriding "mature" for ${c.name} — article reports stage "${c.stage}"`);
          continue;
        }
        counts[r.maturity] = (counts[r.maturity] ?? 0) + 1;
        updates.push({ ...c, maturity: r.maturity, maturity_source: "model" });
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) { console.error(`[maturity] ABORTED — ${e.message}`); break; }
      console.error(`[maturity] batch ${i}: ${(e as Error).message}`);
    }
    if ((i / BATCH) % 5 === 4) {
      console.log(`[maturity] ${Math.min(i + BATCH, names.length)}/${names.length} · $${spentUsd().toFixed(3)}`);
      if (APPLY && updates.length) await upsert("companies", updates.splice(0), "name_normalized");
    }
  }
  if (APPLY && updates.length) await upsert("companies", updates, "name_normalized");

  console.log(`\n[maturity] classified: ${JSON.stringify(counts)}`);
  logSummary();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
