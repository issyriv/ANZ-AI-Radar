import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Candidate } from "../lib/types";

const one = (s: string | null, n = 150) =>
  s ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";

async function main() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("candidates").select("*");
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Candidate[];
  const enriched = all.filter((c) => c.fit_score !== null);

  // distribution
  const dist: Record<string, number> = {};
  for (const c of enriched) dist[String(c.fit_score)] = (dist[String(c.fit_score)] ?? 0) + 1;
  console.log(`\nTotal ${all.length}, enriched ${enriched.length}. Fit distribution:`);
  for (let s = 10; s >= 1; s--) if (dist[s]) console.log(`  fit ${s}: ${dist[s]}`);

  const fmt = (c: Candidate) =>
    `  ${c.github_login}${c.name ? ` (${c.name})` : ""} | ${c.location_normalized ?? "?"} | fit ${c.fit_score} | ${c.followers} foll | AI30d ${c.starred_ai_30d}\n     ${one(c.bio, 90)}\n     ${one(c.enrichment_summary, 200)}`;

  console.log(`\n=== OVERALL TOP 12 BY FIT ===`);
  for (const c of [...enriched].sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0)).slice(0, 12)) {
    console.log(fmt(c));
  }

  // The actual test: obscure long-tail = low followers, decent fit
  const longtail = enriched
    .filter((c) => c.followers < 250 && (c.fit_score ?? 0) >= 5)
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0) || b.starred_ai_30d - a.starred_ai_30d);
  console.log(`\n=== LONG-TAIL FINDS (followers < 250, fit >= 5): ${longtail.length} ===`);
  for (const c of longtail.slice(0, 15)) console.log(fmt(c));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
