import "./_bootstrap";
import { writeFileSync } from "fs";
import { collectUkAiHiring } from "../lib/sources/hiring";
import { normalizeName } from "../lib/extract";
import { loadCompanies } from "../lib/store";

// Free: no model calls, no API key. Writes the companies hiring in the UK for
// AI roles that are NOT already in the deal-flow map.

const MONTHS = Number(process.env.HIRING_MONTHS ?? 12);
const OUT = process.env.HIRING_OUT ?? ".data/hiring.json";

async function main() {
  const known = new Set((await loadCompanies()).map((c) => c.name_normalized).filter(Boolean));
  console.log(`[hiring] scanning ${MONTHS} monthly HN threads · excluding ${known.size} known companies`);

  const posts = await collectUkAiHiring(MONTHS);
  const byCompany = new Map<string, { company: string; posts: number; first: string; last: string; url: string | null; text: string }>();
  for (const p of posts) {
    const k = normalizeName(p.company);
    const e = byCompany.get(k);
    if (e) {
      e.posts++;
      if (p.threadDate < e.first) e.first = p.threadDate;
      if (p.threadDate > e.last) e.last = p.threadDate;
      e.url = e.url ?? p.url;
    } else {
      byCompany.set(k, { company: p.company, posts: 1, first: p.threadDate, last: p.threadDate, url: p.url, text: p.text });
    }
  }

  const all = [...byCompany.entries()];
  const fresh = all.filter(([k]) => !known.has(k)).map(([, v]) => v);
  // Repeat posters are hiring persistently, which is a stronger signal than one post.
  fresh.sort((a, b) => b.posts - a.posts || b.last.localeCompare(a.last));

  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), count: fresh.length, companies: fresh }, null, 2));
  console.log(`[hiring] ${posts.length} UK+AI posts · ${all.length} distinct companies · ${fresh.length} NOT already known -> ${OUT}`);
  console.log(`\n[hiring] top by persistence:`);
  for (const f of fresh.slice(0, 20)) {
    console.log(`  ${String(f.posts).padStart(2)}x  ${f.company.padEnd(26)} ${f.last}  ${f.url ?? ""}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
