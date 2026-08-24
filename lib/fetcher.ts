// Smart page fetcher: HTTP first, headless browser as fallback, disk cache in
// front of both.
//
// The crawl hits ~70 sources and gets re-run while iterating on prompts, so
// three things matter: never pay for a render we do not need, never re-fetch a
// page we already have, and never let one bad host stall the run.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { renderPage, type RenderOptions } from "./browser";

const CACHE_DIR = process.env.CRAWL_CACHE_DIR ?? ".cache/pages";
const CACHE_TTL_MS = Number(process.env.CRAWL_CACHE_TTL_MS ?? 12 * 60 * 60 * 1000);
const CACHE_ENABLED = process.env.CRAWL_CACHE !== "0";
const HTTP_TIMEOUT = Number(process.env.CRAWL_HTTP_TIMEOUT ?? 30_000);

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type FetchMode = "auto" | "http" | "headless";

export interface FetchResult {
  url: string;
  status: number;
  html: string;
  text: string;
  labels: string[];
  /** Names recovered from `/companies/<slug>` style detail links. */
  slugNames: string[];
  feedItems: number;
  via: "http" | "headless" | "cache";
  ms: number;
  error?: string;
}

export function stripHtml(html: string): string {
  return html
    // CDATA must be unwrapped BEFORE tag stripping: `<![CDATA[Some title]]>`
    // is matched end-to-end by /<[^>]+>/ and would otherwise vanish entirely,
    // silently emptying every CDATA-wrapped RSS title.
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8217;|&#0?39;|&apos;|&#8216;/g, "'")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Company names in a portfolio grid usually live in image alt / link title
 * attributes rather than in visible text, so these are first-class signal.
 */
export function extractLabels(html: string): string[] {
  const junk =
    /^(logo|icon|menu|arrow|close|search|image|next|previous|prev|home|about|team|contact|careers|news|insights|read more|learn more|view all|portfolio|companies|blank|spinner|cookies? settings|powered by onetrust|accept all|opens in a new window)$/i;
  return Array.from(
    new Set(
      Array.from(html.matchAll(/(?:alt|title)="([^"]{2,60})"/gi), (m) =>
        // Grids label images "<Company> featured photo", "<Company> logo image".
        // Left in place the suffix becomes part of the company name downstream.
        m[1]
          .trim()
          .replace(/\s+(featured\s+)?(photo|image|logo|icon|thumbnail|headshot|portrait)$/i, "")
          .replace(/\s+(opens?\s+in\s+a\s+new\s+(window|tab))$/i, "")
          .trim(),
      ),
    ),
  ).filter((l) => l && !junk.test(l) && !/logo|\.(png|jpg|svg|webp)$/i.test(l));
}

/**
 * Company names recovered from detail-page links (`/companies/<slug>`).
 *
 * A third source of names, and on some sites the only one. phoenixcourt.vc
 * (LocalGlobe / Latitude) renders 274 companies with the names present ONLY in
 * hrefs — the visible text carries descriptions with no names attached, and the
 * cards use no alt text. Both the prose path and the logo-grid path see nothing.
 */
const SLUG_PATH_RE =
  /href="[^"]*\/(?:companies|portfolio|portfolio-companies|company|investments|ventures|our-companies)\/([a-z0-9][a-z0-9-]{1,48})(?:\/)?"/gi;

const SLUG_STOPWORDS = new Set([
  "all", "index", "list", "search", "filter", "page", "more", "archive", "category",
  "tag", "team", "about", "contact", "news", "insights", "jobs", "careers", "apply",
  "founders-ceos", "portfolio-founders-ceos",
]);

export function extractSlugNames(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(SLUG_PATH_RE)) {
    const slug = m[1].toLowerCase();
    if (SLUG_STOPWORDS.has(slug)) continue;
    if (/^\d+$/.test(slug)) continue;          // pagination
    if (slug.split("-").length > 5) continue;   // a blog-post slug, not a company
    out.add(
      slug
        .split("-")
        .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
        .join(" "),
    );
  }
  return [...out];
}

function countFeedItems(html: string): number {
  return (html.match(/<item[\s>]/gi) ?? []).length + (html.match(/<entry[\s>]/gi) ?? []).length;
}

/** Did a plain HTTP fetch actually give us usable content? */
export function isUsable(
  text: string,
  labels: string[],
  feedItems: number,
  slugNames: string[] = [],
): boolean {
  return text.length > 2500 || labels.length >= 15 || slugNames.length >= 10 || feedItems > 0;
}

// --- disk cache -------------------------------------------------------------

function cachePath(url: string, mode: string): string {
  const key = createHash("sha1").update(`${mode}:${url}`).digest("hex");
  return join(CACHE_DIR, `${key}.json`);
}

function readCache(url: string, mode: string, ttl: number): { html: string; status: number } | null {
  if (!CACHE_ENABLED) return null;
  const p = cachePath(url, mode);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, "utf8")) as {
      url: string; status: number; html: string; fetchedAt: number;
    };
    if (Date.now() - rec.fetchedAt > ttl) return null;
    return { html: rec.html, status: rec.status };
  } catch {
    return null;
  }
}

function writeCache(url: string, mode: string, status: number, html: string): void {
  if (!CACHE_ENABLED) return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      cachePath(url, mode),
      JSON.stringify({ url, status, html, fetchedAt: Date.now() }),
    );
  } catch {
    /* cache is best-effort */
  }
}

// --- fetching ---------------------------------------------------------------

async function httpFetch(url: string): Promise<{ status: number; html: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
  });
  return { status: res.status, html: await res.text() };
}

function result(url: string, status: number, html: string, via: FetchResult["via"], ms: number): FetchResult {
  const text = stripHtml(html);
  const labels = extractLabels(html);
  const slugNames = extractSlugNames(html);
  return { url, status, html, text, labels, slugNames, feedItems: countFeedItems(html), via, ms };
}

export interface SmartFetchOptions {
  /** "auto" (default) tries HTTP then falls back to headless if the page is thin. */
  mode?: FetchMode;
  render?: RenderOptions;
  cacheTtlMs?: number;
}

/**
 * Fetch `url` and report how we got it. Never throws: a failure comes back as a
 * result with `error` set and empty content, so one dead host cannot abort a crawl.
 */
export async function smartFetch(url: string, opts: SmartFetchOptions = {}): Promise<FetchResult> {
  const mode = opts.mode ?? "auto";
  const ttl = opts.cacheTtlMs ?? CACHE_TTL_MS;
  const t0 = Date.now();

  // Headless-only sources skip the HTTP attempt entirely.
  if (mode !== "headless") {
    const cached = readCache(url, "http", ttl);
    if (cached) {
      const r = result(url, cached.status, cached.html, "cache", Date.now() - t0);
      if (mode === "http" || isUsable(r.text, r.labels, r.feedItems, r.slugNames)) return r;
    } else {
      try {
        const { status, html } = await httpFetch(url);
        writeCache(url, "http", status, html);
        const r = result(url, status, html, "http", Date.now() - t0);
        if (mode === "http") return r;
        if (status < 400 && isUsable(r.text, r.labels, r.feedItems, r.slugNames)) return r;
        console.log(
          `[fetch] ${url} thin over http (status ${status}, ${r.text.length} chars, ${r.labels.length} labels) -> headless`,
        );
      } catch (e) {
        if (mode === "http") {
          return { ...result(url, 0, "", "http", Date.now() - t0), error: (e as Error).message };
        }
        console.log(`[fetch] ${url} http failed (${(e as Error).message}) -> headless`);
      }
    }
  }

  // Headless path.
  const cachedR = readCache(url, "headless", ttl);
  if (cachedR) return result(url, cachedR.status, cachedR.html, "cache", Date.now() - t0);
  try {
    const html = await renderPage(url, opts.render ?? { scroll: true });
    writeCache(url, "headless", 200, html);
    return result(url, 200, html, "headless", Date.now() - t0);
  } catch (e) {
    return { ...result(url, 0, "", "headless", Date.now() - t0), error: (e as Error).message };
  }
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
