import "./_bootstrap";
import { BULK_MODEL, extract, LIST_SYSTEM } from "../lib/extract";
import { BudgetExceededError, logSummary, spentUsd } from "../lib/cost";
import { THESIS_KEYS } from "../lib/fund";
import { loadCompanies, upsert } from "../lib/store";
import type { Company } from "../lib/types";

// Re-score stored companies against the current thesis.
//
// Needed whenever lib/fund.ts THESIS_DIMENSIONS changes: a stored
// thesis_fit_score is only meaningful against the thesis that produced it, and
// after the 2026 recalibration every existing row was carrying a score from the
// old generic-durability model.
//
// Ordered by current score descending so that if the budget runs out the top of
// the deck — the part anyone actually looks at — is the part that got redone.

const UK = /^(united kingdom|uk|england|scotland|wales|northern ireland|britain)$/i;
const BATCH = Number(process.env.RESCORE_BATCH ?? 10);
const LIMIT = process.env.RESCORE_LIMIT ? Number(process.env.RESCORE_LIMIT) : undefined;
const AI_ONLY = process.env.RESCORE_ALL !== "1";

/** A row is stale if it lacks any of the current thesis dimensions. */
function isStale(c: Company): boolean {
  const b = (c.thesis_breakdown ?? {}) as Record<string, unknown>;
  return THESIS_KEYS.some((k) => !b[k]);
}

async function main() {
  const all = await loadCompanies();
  let todo = all.filter((c) => {
    if (c.hq_country && !UK.test(String(c.hq_country).trim())) return false;
    if (c.maturity === "mature") return false;
    if (c.thesis_misfit) return false;
    if (AI_ONLY && !c.ai_native) return false;
    return isStale(c);
  });
  todo.sort((a, b) => (b.thesis_fit_score ?? 0) - (a.thesis_fit_score ?? 0));
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log(`[rescore] ${todo.length} companies to re-score against the current thesis`);
  const byName = new Map(todo.map((c) => [c.name.toLowerCase(), c]));
  let done = 0;
  let aborted = false;

  for (let i = 0; i < todo.length && !aborted; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const text =
      `Score each of these known UK companies against the thesis. Each bullet is one company:\n\n` +
      batch
        .map((c) => `- ${c.name}${c.sector ? ` (${c.sector})` : ""}: ${c.description || c.summary || "no description available"}`)
        .join("\n");
    try {
      const scored = await extract(LIST_SYSTEM, text, BULK_MODEL);
      const updates: Record<string, unknown>[] = [];
      for (const s of scored) {
        const orig = byName.get((s.name ?? "").toLowerCase());
        if (!orig) continue;
        updates.push({
          ...orig,
          thesis_fit_score: s.thesis_fit_score ?? orig.thesis_fit_score,
          thesis_breakdown: s.thesis_breakdown ?? orig.thesis_breakdown,
          thesis_misfit: !!s.thesis_misfit,
          misfit_reason: s.misfit_reason || null,
          summary: s.summary || orig.summary,
          sector: s.sector || orig.sector,
          scoring_model: BULK_MODEL,
          scored_at: new Date().toISOString(),
          thesis_version: "northzone-2026",
        });
      }
      if (updates.length) {
        await upsert("companies", updates, "name_normalized");
        done += updates.length;
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        console.error(`[rescore] ABORTED — ${e.message}`);
        aborted = true;
        break;
      }
      console.error(`[rescore] batch ${i}: ${(e as Error).message}`);
    }
    if ((i / BATCH) % 5 === 4) {
      console.log(`[rescore] ${Math.min(i + BATCH, todo.length)}/${todo.length} · ${done} updated · $${spentUsd().toFixed(3)}`);
    }
  }

  console.log(`\n[rescore] ${done}/${todo.length} re-scored on the current thesis`);
  if (aborted) console.log(`[rescore] budget stopped it early — the highest-scoring rows were done first`);
  logSummary();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
