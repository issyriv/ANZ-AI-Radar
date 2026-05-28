import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Company } from "../lib/types";

const one = (s: string | null, n = 130) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

async function main() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("companies")
    .select("*")
    .order("thesis_fit_score", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Company[];

  const dist: Record<string, number> = {};
  for (const c of rows) dist[String(c.thesis_fit_score)] = (dist[String(c.thesis_fit_score)] ?? 0) + 1;
  console.log(`\n${rows.length} companies. Fit distribution:`);
  for (let s = 10; s >= 1; s--) if (dist[s]) console.log(`  fit ${s}: ${dist[s]}`);
  const ai = rows.filter((c) => c.ai_native).length;
  console.log(`AI-native: ${ai}/${rows.length}\n`);

  console.log("=== TOP 25 BY THESIS FIT ===");
  for (const c of rows.slice(0, 25)) {
    const ov = (c.airtree_overlap ?? []).length ? ` [${c.airtree_overlap.join(",")}]` : "";
    console.log(
      `fit ${c.thesis_fit_score ?? "-"} | ${c.name}${c.ai_native ? " (AI)" : ""} | ${c.sector ?? "?"} | ${c.stage ?? "?"} | ${c.amount_raised ?? "?"}${ov}`,
    );
    if (c.summary) console.log(`     ${one(c.summary, 150)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
