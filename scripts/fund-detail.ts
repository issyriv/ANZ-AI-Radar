import "./_bootstrap";
import { readFileSync, writeFileSync } from "fs";
import { closeBrowser } from "../lib/browser";
import { pool, smartFetch } from "../lib/fetcher";

// Enrich lib/fund-portfolio.json from each company's own Northzone page.
//
// The listing page gives name/status/stage/industry/country. The DETAIL pages
// carry the fields that make a time series possible:
//   Founded <year>    - when the company started
//   Partnered <year>  - when NORTHZONE INVESTED  <- the one that matters
//   Northzone Team    - the partner who led it
// Free: their own site, no API, no model calls.

const OUT = "lib/fund-portfolio.json";

interface Row {
  name: string; slug: string; status: string | null; stage: string | null;
  industries: string[]; countries: string[];
  founded?: number | null; partnered?: number | null;
  partner?: string | null; founders?: string[]; unicorn?: boolean;
}

function parseDetail(text: string, row: Row): Row {
  const t = text.replace(/^[\s\S]*?Offices\s+/, "");
  const founded = t.match(/\bFounded\s+((?:19|20)\d{2})/)?.[1];
  const partnered = t.match(/\bPartnered\s+((?:19|20)\d{2})/)?.[1];
  const partner = t.match(/Northzone Team\s+([A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’-]+){0,2})/)?.[1] ?? null;
  // Founders sit between the company name and the status keyword.
  const esc = row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fm = t.match(new RegExp(`^${esc}\\s+(.+?)\\s+(Active|Acquired|IPO|Partnered)\\b`));
  const founders = fm
    ? fm[1].split(/,\s*/).map((s) => s.trim()).filter((s) => s && s.length < 40 && /[A-Za-z]/.test(s))
    : [];
  return {
    ...row,
    founded: founded ? Number(founded) : null,
    partnered: partnered ? Number(partnered) : null,
    partner,
    founders,
    unicorn: /\bUnicorn\b/.test(t),
  };
}

async function main() {
  const doc = JSON.parse(readFileSync(OUT, "utf8")) as { companies: Row[] };
  const rows = doc.companies.filter((c) => c.slug);
  console.log(`[detail] fetching ${rows.length} portfolio detail pages`);

  let done = 0;
  const out = await pool(rows, 4, async (r) => {
    const res = await smartFetch(`https://northzone.com/portfolio/${r.slug}`, { mode: "http" });
    done++;
    if (done % 25 === 0) console.log(`[detail] ${done}/${rows.length}`);
    if (res.error || res.text.length < 200) return r;
    return parseDetail(res.text, r);
  });

  const merged = doc.companies.map((c) => out.find((o) => o.slug === c.slug) ?? c);
  writeFileSync(OUT, JSON.stringify({ ...doc, companies: merged, detail_synced_at: new Date().toISOString() }, null, 2) + "\n");

  const withYear = merged.filter((c) => c.partnered);
  console.log(`\n[detail] ${withYear.length}/${merged.length} have a "Partnered" year`);
  const byYear: Record<string, number> = {};
  for (const c of withYear) byYear[String(c.partnered)] = (byYear[String(c.partnered)] ?? 0) + 1;
  console.log("[detail] investments per year:");
  for (const y of Object.keys(byYear).sort()) console.log(`   ${y}  ${"#".repeat(byYear[y])} ${byYear[y]}`);
  await closeBrowser();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await closeBrowser(); process.exit(1); });
