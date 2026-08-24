import "./_bootstrap";
import { readFileSync, writeFileSync } from "fs";
import { renderPage, closeBrowser } from "../lib/browser";

// Regenerates lib/fund-portfolio.json from Northzone's live portfolio page.
//
// The portfolio IS the fund profile: it gives us the alumni list for overlap
// detection, and it encodes what Northzone actually backs (stage, industry,
// geography). Hardcoding 140+ names would rot; this keeps it one command.
//
//   npx tsx scripts/fund-sync.ts

const URL = "https://northzone.com/portfolio/";
const OUT = "lib/fund-portfolio.json";

const STATUS = ["Active", "Acquired", "IPO", "Partnered"];
const STAGES = ["Series A", "Series B", "Seed", "Growth"];
const INDUSTRIES = ["AI", "Climate & Energy", "Consumer", "Enterprise", "Fintech", "Healthcare", "Infra & DevTools"];
const COUNTRIES = [
  "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Ireland", "Italy",
  "Netherlands", "Norway", "Spain", "Sweden", "Switzerland", "Türkiye", "United Arab Emirates",
  "United Kingdom", "United States",
];

export interface FundCompany {
  name: string;
  slug: string;
  status: string | null;
  stage: string | null;
  industries: string[];
  countries: string[];
}

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The listing renders as a flat run of tokens:
//   <Name> <Status> <Stage> <Industry...> <Country...>  <Name> <Status> ...
// with single-letter alphabet headers ("A", "B", ...) interleaved. We anchor on
// the Status+Stage pair, consume the trailing Industry/Country vocabulary, and
// whatever sits between the end of one record and the next anchor is the name.
function parse(html: string): FundCompany[] {
  const text = toText(html);
  const slugByNorm = new Map<string, string>();
  for (const m of html.matchAll(/\/portfolio\/([a-z0-9.-]+)/gi)) {
    slugByNorm.set(m[1].replace(/[^a-z0-9]/g, ""), m[1]);
  }

  const anchor = new RegExp(`\\b(${STATUS.join("|")})\\s+(${STAGES.join("|")})\\b`, "g");
  const vocab = [...INDUSTRIES, ...COUNTRIES].sort((a, b) => b.length - a.length);

  const out: FundCompany[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  for (const m of text.matchAll(anchor)) {
    const nameRaw = text.slice(cursor, m.index!).trim();
    // Consume the Industry/Country vocabulary that follows the stage.
    let p = m.index! + m[0].length;
    const industries: string[] = [];
    const countries: string[] = [];
    for (;;) {
      const rest = text.slice(p);
      const hit = vocab.find((v) => rest.startsWith(" " + v));
      if (!hit) break;
      if (INDUSTRIES.includes(hit)) industries.push(hit);
      else countries.push(hit);
      p += hit.length + 1;
    }
    cursor = p;

    // Drop the alphabet header and any leading nav crumbs. The first record is
    // preceded by the whole filter UI, so fall back to the text after the last
    // single-letter alphabet header.
    let name = nameRaw.replace(/^[A-Z]\s+(?=[A-Z0-9])/, "").trim();
    if (name.length > 40) {
      const header = nameRaw.lastIndexOf(" ", nameRaw.length);
      void header;
      const m2 = [...nameRaw.matchAll(/(?:^|\s)[A-Z](?=\s)/g)].pop();
      if (m2) name = nameRaw.slice(m2.index! + m2[0].length).trim();
    }
    if (!name || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      slug: slugByNorm.get(key.replace(/[^a-z0-9]/g, "")) ?? "",
      status: m[1],
      stage: m[2],
      industries,
      countries,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  // FUND_SYNC_HTML lets us re-parse a captured page without re-rendering it,
  // which is how the parser gets iterated on when the layout changes.
  const cached = process.env.FUND_SYNC_HTML;
  let html: string;
  if (cached) {
    console.log(`[fund-sync] parsing cached ${cached}`);
    html = readFileSync(cached, "utf8");
  } else {
    console.log(`[fund-sync] rendering ${URL}`);
    html = await renderPage(URL, { scroll: true });
  }
  const companies = parse(html);
  if (companies.length < 50) {
    throw new Error(`only parsed ${companies.length} companies — page layout probably changed`);
  }
  const uk = companies.filter((c) => c.countries.includes("United Kingdom"));
  const ai = companies.filter((c) => c.industries.includes("AI"));
  const payload = {
    fund: "Northzone",
    source_url: URL,
    synced_at: new Date().toISOString(),
    count: companies.length,
    companies,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`[fund-sync] ${companies.length} companies -> ${OUT}`);
  console.log(`[fund-sync]   ${uk.length} United Kingdom, ${ai.length} tagged AI`);
  console.log(`[fund-sync]   UK: ${uk.map((c) => c.name).join(", ")}`);
  await closeBrowser();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
