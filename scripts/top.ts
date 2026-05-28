import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Candidate } from "../lib/types";

// Quick terminal inspection of stored candidates.
// npm run top                  -> order by fit (falls back to AI stars if unenriched)
const LIMIT = Number(process.env.TOP_LIMIT ?? 25);

function trunc(s: string | null, n: number): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}

async function main() {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("candidates").select("*", { count: "exact" }).limit(1);
  const { data, error } = await sb
    .from("candidates")
    .select("*")
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("starred_ai_30d", { ascending: false })
    .order("starred_ai_count", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Candidate[];

  console.log(`\nTotal candidates in DB: ${count ?? 0}. Showing top ${rows.length}.\n`);
  rows.forEach((c, i) => {
    const fit = c.fit_score === null ? "—" : String(c.fit_score);
    const lastAi = c.last_ai_activity_at ? c.last_ai_activity_at.slice(0, 10) : "—";
    console.log(
      `${String(i + 1).padStart(2)}. ${c.github_login}${c.name ? ` (${c.name})` : ""}` +
        ` | ${c.location_normalized ?? c.location ?? "?"} | fit ${fit}` +
        ` | ${c.followers} foll | AI★ ${c.starred_ai_count} (30d:${c.starred_ai_30d}) | lastAI ${lastAi}`,
    );
    if (c.bio) console.log(`    bio: ${trunc(c.bio, 110)}`);
    if (c.company) console.log(`    company: ${trunc(c.company, 60)}`);
    const repos = (c.top_repos as { name: string; stars: number }[]) ?? [];
    if (repos.length) {
      console.log(`    repos: ${repos.slice(0, 4).map((r) => `${r.name}(${r.stars}★)`).join(", ")}`);
    }
    if (c.matched_signals?.length) console.log(`    signals: ${c.matched_signals.slice(0, 4).join("; ")}`);
    console.log("");
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
