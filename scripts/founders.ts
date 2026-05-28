import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Candidate } from "../lib/types";

// Surface candidates that look like they have / are starting a company.
const FOUNDER_TERMS = [
  "founder", "co-found", "cofound", "ceo", "cto", "stealth", "building ",
  "we're building", "startup", "start-up", "my company", "incorporated",
  "raised", "seed", " yc ", "y combinator", "antler", "startmate", "founding",
];

function hits(text: string): string[] {
  const t = text.toLowerCase();
  return FOUNDER_TERMS.filter((k) => t.includes(k));
}

async function main() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("candidates")
    .select("*")
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(60);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Candidate[];

  const flagged: { c: Candidate; why: string[] }[] = [];
  for (const c of rows) {
    const blob = `${c.bio ?? ""} || ${c.company ?? ""} || ${c.enrichment_summary ?? ""} || ${(c.signals ?? []).join(" ")}`;
    const why = hits(blob);
    if (why.length) flagged.push({ c, why });
  }

  console.log(`\n${flagged.length} of top ${rows.length} show startup/founder language:\n`);
  for (const { c, why } of flagged) {
    console.log(`• ${c.github_login}${c.name ? ` (${c.name})` : ""} | ${c.location_normalized ?? "?"} | fit ${c.fit_score}`);
    if (c.company) console.log(`    company: ${c.company}`);
    if (c.bio) console.log(`    bio: ${c.bio.replace(/\s+/g, " ").slice(0, 140)}`);
    if (c.enrichment_summary) console.log(`    summary: ${c.enrichment_summary.replace(/\s+/g, " ")}`);
    if (c.airtree_alumni_match?.length) console.log(`    ALUMNI: ${c.airtree_alumni_match.join(", ")}`);
    console.log(`    matched terms: ${why.join(", ")}`);
    console.log("");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
