import "./_bootstrap";
import { classifyMisfit } from "../lib/misfit";
import { loadCompanies, upsert } from "../lib/store";

// Flag stored companies that match a stated thesis anti-pattern. Free: no model
// calls. Re-run after changing the patterns in lib/misfit.ts.

async function main() {
  const all = await loadCompanies();
  const updates: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};

  for (const c of all) {
    const text = [c.name, c.sector, c.description, c.summary].filter(Boolean).join(" ");
    const v = classifyMisfit(text);
    if (v.misfit === !!c.thesis_misfit && v.reason === (c.misfit_reason ?? null)) continue;
    if (v.misfit) counts[v.reason!] = (counts[v.reason!] ?? 0) + 1;
    updates.push({ ...c, thesis_misfit: v.misfit, misfit_reason: v.reason });
  }

  await upsert("companies", updates, "name_normalized");
  console.log(`[misfits] updated ${updates.length} rows`);
  console.log(`[misfits] flagged: ${JSON.stringify(counts)}`);

  const after = await loadCompanies();
  const flagged = after.filter((c) => c.thesis_misfit);
  const hi = flagged.filter((c) => (c.thesis_fit_score ?? 0) >= 7);
  console.log(`[misfits] ${flagged.length} misfits total, ${hi.length} of them were scoring 7+`);
  for (const c of hi.slice(0, 15)) {
    console.log(`[misfits]   ${String(c.thesis_fit_score).padStart(2)}  ${c.name.padEnd(24)} ${c.misfit_reason}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
