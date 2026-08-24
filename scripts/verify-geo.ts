import "./_bootstrap";
import { getAnthropic, HAIKU } from "../lib/anthropic";
import { assertBudget, BudgetExceededError, logSummary, spentUsd, record } from "../lib/cost";
import { loadCompanies, upsert } from "../lib/store";

// Retrospective HQ-country check over companies already stored.
//
// The first crawl ran with a prompt that said "only include UK companies", and
// the model satisfied that by relabelling rather than omitting: Figma, Notion,
// Roblox and Personio all came back tagged as London. The prompt is fixed for
// future runs, but rows already written need correcting, and re-crawling costs
// far more than asking one cheap question about the names we already have.
//
// Deliberately a NARROW question. This pass is told nothing about the UK, the
// thesis or the fund — it only reports where each company is headquartered, so
// there is no instruction pulling it toward a convenient answer.

const BATCH = 25;
const APPLY = !process.argv.includes("--dry-run");

const SYSTEM = `You are given a list of company names. For each one, report the country of its global headquarters.

Rules:
- Use the country's common English name: "United Kingdom", "United States", "Germany", "Sweden", "Ireland".
- Report the GLOBAL headquarters, not a regional office. Many of these companies have a London office; that does not make them United Kingdom.
- If you do not recognise the company, or you are not confident, return "unknown". Do not guess. "unknown" is a useful answer and a wrong country is not.
- Return one entry per input name, using the name exactly as given.`;

const TOOL = {
  name: "record_countries",
  description: "Report the HQ country of each company.",
  input_schema: {
    type: "object" as const,
    properties: {
      companies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            hq_country: { type: "string", description: 'Common English country name, or "unknown".' },
            confidence: { type: "integer", minimum: 1, maximum: 10 },
          },
          required: ["name", "hq_country", "confidence"],
        },
      },
    },
    required: ["companies"],
  },
};

const UK = /^(united kingdom|uk|u\.k\.|great britain|britain|england|scotland|wales|northern ireland|gb)$/i;

async function checkBatch(names: string[]) {
  assertBudget();
  const msg = await getAnthropic().messages.create({
    model: HAIKU,
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_countries" },
    messages: [{ role: "user", content: names.map((n) => `- ${n}`).join("\n") }],
  });
  record(HAIKU, msg.usage);
  const use = msg.content.find((b) => b.type === "tool_use");
  if (!use || use.type !== "tool_use") return [];
  return (use.input as { companies?: { name: string; hq_country: string; confidence: number }[] })
    .companies ?? [];
}

async function main() {
  const companies = await loadCompanies();
  console.log(`[geo] checking ${companies.length} stored companies (${APPLY ? "apply" : "dry run"})`);

  const byName = new Map(companies.map((c) => [c.name, c]));
  const names = [...byName.keys()];
  const corrections: { name: string; was: string | null; now: string; confidence: number }[] = [];

  for (let i = 0; i < names.length; i += BATCH) {
    try {
      const res = await checkBatch(names.slice(i, i + BATCH));
      for (const r of res) {
        const c = byName.get(r.name);
        if (!c) continue;
        // Only act on a confident non-UK verdict. "unknown" and low confidence
        // are left alone: this pass exists to remove clear errors, not to prune
        // anything the model failed to recognise.
        if (/^unknown$/i.test(r.hq_country) || r.confidence < 8) continue; // conf 7 proved unreliable: it wrongly excluded Cloudsmith (Belfast) and Garrison (London)
        if (!UK.test(r.hq_country.trim())) {
          corrections.push({ name: r.name, was: c.hq_city, now: r.hq_country, confidence: r.confidence });
        }
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) { console.error(`[geo] ABORTED — ${e.message}`); break; }
      console.error(`[geo] batch ${i}: ${(e as Error).message}`);
    }
    if ((i / BATCH) % 5 === 4) console.log(`[geo] ${Math.min(i + BATCH, names.length)}/${names.length}, $${spentUsd().toFixed(3)}`);
  }

  console.log(`\n[geo] ${corrections.length} companies are confidently NOT UK-headquartered:`);
  for (const c of corrections) {
    console.log(`[geo]   ${c.name.padEnd(28)} was hq_city=${String(c.was ?? "-").padEnd(12)} -> ${c.now} (conf ${c.confidence})`);
  }

  if (APPLY && corrections.length) {
    // Keep the rows but mark them truthfully; the UI filters on hq_country, so
    // deleting would silently lose the provenance of a real extraction.
    const rows = corrections.map((c) => {
      const orig = byName.get(c.name)!;
      return { ...orig, hq_country: c.now, hq_city: null };
    });
    const n = await upsert("companies", rows as unknown as Record<string, unknown>[], "name_normalized");
    console.log(`[geo] corrected ${n} rows`);
  } else if (!APPLY) {
    console.log("[geo] dry run — nothing written");
  }
  logSummary();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
