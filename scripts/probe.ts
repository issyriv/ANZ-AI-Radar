import "./_bootstrap";
import { CANDIDATE_URLS } from "../lib/sources/candidates";

// Source triage. Fetches every candidate URL over plain HTTP and reports the
// signal a static scrape would actually see: visible text length and the number
// of usable alt/title labels (portfolio grids put company names there).
//
// Anything that comes back thin is a JS-rendered site and belongs on the
// headless path. Run: npx tsx scripts/probe.ts

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labels(html: string): number {
  return new Set(
    Array.from(html.matchAll(/(?:alt|title)="([^"]{2,60})"/gi), (m) => m[1].trim()).filter(
      (l) => l && !/logo|icon|menu|arrow|close|search|^image$/i.test(l),
    ),
  ).size;
}

async function probe(name: string, url: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml" },
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    const html = await res.text();
    const text = stripHtml(html);
    const lab = labels(html);
    const items = (html.match(/<item[\s>]/gi) ?? []).length + (html.match(/<entry[\s>]/gi) ?? []).length;
    // A page is "static-usable" if it exposes real prose, a logo grid, or feed items.
    const usable = text.length > 2500 || lab >= 15 || items > 0;
    console.log(
      [
        usable ? "OK  " : "THIN",
        String(res.status).padEnd(3),
        `${Date.now() - t0}ms`.padStart(7),
        `text=${String(text.length).padStart(7)}`,
        `labels=${String(lab).padStart(4)}`,
        `feeditems=${String(items).padStart(3)}`,
        name.padEnd(28),
        url,
      ].join("  "),
    );
  } catch (e) {
    console.log(
      ["ERR ", "---", `${Date.now() - t0}ms`.padStart(7), "".padEnd(38), name.padEnd(28), url, (e as Error).message].join("  "),
    );
  }
}

async function main() {
  const pool = 8;
  const queue = [...CANDIDATE_URLS];
  await Promise.all(
    Array.from({ length: pool }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await probe(next.name, next.url);
      }
    }),
  );
  process.exit(0);
}

main();
