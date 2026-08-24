import "./_bootstrap";
import { randomUUID } from "crypto";
import { closeBrowser } from "../lib/browser";
import { BudgetExceededError, logSummary, spentUsd } from "../lib/cost";
import {
  extract,
  normalizeName,
  isPlausibleCompanyName,
  isKnownNonUk,
  ARTICLE_SYSTEM,
  ARTICLE_MODEL,
  BULK_MODEL,
  LIST_SYSTEM,
  PORTFOLIO_SYSTEM,
  type ExtractedCompany,
} from "../lib/extract";
import { pool, sleep, smartFetch, stripHtml } from "../lib/fetcher";
import { FEEDS, LISTINGS, PORTFOLIOS, type PortfolioSource } from "../lib/sources";
import { backend, loadCompanies, recordSourceRuns, upsertCompanies } from "../lib/store";


// --- tunables ---------------------------------------------------------------
const ONLY = process.env.DEALS_ONLY ?? ""; // news | portfolios | yc | "" = all
const CONCURRENCY = Number(process.env.DEALS_CONCURRENCY ?? 4);
const MAX_ARTICLES = Number(process.env.DEALS_MAX_ARTICLES ?? 120);
const LISTING_PAGES = Number(process.env.DEALS_LISTING_PAGES ?? 3);
const PORTFOLIO_MAX_CHARS = Number(process.env.PORTFOLIO_MAX_CHARS ?? 60_000);
const LABEL_BATCH = Number(process.env.DEALS_LABEL_BATCH ?? 12);
const ONLY_SOURCE = process.env.DEALS_SOURCE ?? ""; // comma-separated substrings; runs only matching sources

const RUN_ID = randomUUID();
// Portfolio grids overlap heavily between funds. Re-scoring a company we already
// have costs money and changes nothing, so by default we only score names we
// have not seen. DEALS_RESCORE=1 forces a full re-score.
const RESCORE = process.env.DEALS_RESCORE === "1";
const alreadyScored = new Set<string>();
const SCORED_AT = () => new Date().toISOString();

const FUNDING_RE =
  /\b(raise[sd]?|raising|funding|seed|series\s+[a-d]\b|pre-?seed|backed|invest(s|ed|ment)?|round|capital raise|[£$€]\s?\d|grant|valuation|acqui)/i;

interface RunRecord {
  run_id: string;
  source: string;
  source_type: string | null;
  url: string | null;
  mode: string | null;
  via: string | null;
  http_status: number | null;
  ok: boolean;
  items_found: number;
  companies_stored: number;
  duration_ms: number | null;
  error: string | null;
}
const runs: RunRecord[] = [];
let flushed = 0;

// Source-health records are flushed as each stage completes, not only at the
// end. A run that dies partway — budget exhausted, API error, Ctrl-C — is
// exactly the run whose health data you most want to keep.
async function flushRuns(): Promise<void> {
  const pending = runs.slice(flushed);
  if (pending.length === 0) return;
  flushed = runs.length;
  try {
    await recordSourceRuns(pending as unknown as Record<string, unknown>[]);
  } catch (e) {
    console.error(`[deals] could not record source runs: ${(e as Error).message}`);
  }
}

function rowFor(
  c: ExtractedCompany,
  source: string,
  sourceType: string,
  sourceUrl: string,
  publishedAt: string | null,
  investorFallback: string[] = [],
  model: string = BULK_MODEL,
): Record<string, unknown> {
  return {
    name: c.name,
    name_normalized: normalizeName(c.name),
    website: c.website || null,
    description: c.description || null,
    stage: c.stage && !/^unknown$/i.test(c.stage) ? c.stage : null,
    sector: c.sector || null,
    hq_country: c.hq_country || null,
    hq_city: c.hq_city || null,
    ai_native: !!c.ai_native,
    amount_raised: c.amount_raised || null,
    investors: c.investors?.length ? c.investors : investorFallback,
    founders: c.founders ?? [],
    source,
    source_type: sourceType,
    source_url: sourceUrl,
    source_published_at: publishedAt,
    thesis_fit_score: c.thesis_fit_score ?? null,
    thesis_breakdown: c.thesis_breakdown ?? null,
    fund_overlap: c.fund_overlap ?? [],
    thesis_misfit: !!c.thesis_misfit,
    misfit_reason: c.misfit_reason || null,
    summary: c.summary || null,
    scoring_model: model,
    scored_at: SCORED_AT(),
    raw_extract: c,
  };
}

function safeDate(s: string): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function metaContent(html: string, prop: string): string {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${esc}["'][^>]*>`, "i"));
  if (!t) return "";
  const c = t[0].match(/content=["']([^"']*)["']/i);
  return c ? stripHtml(c[1]) : "";
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripHtml(m[1]) : "";
}

function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// --- news -------------------------------------------------------------------

interface Item {
  source: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  broad: boolean;
}

async function collectFeedItems(): Promise<Item[]> {
  const results = await pool(FEEDS, CONCURRENCY, async (f) => {
    const t0 = Date.now();
    const res = await smartFetch(f.url, { mode: "http" });
    const items: Item[] = [];
    if (!res.error && res.status < 400) {
      for (const b of res.html.split(/<item[\s>]/i).slice(1)) {
        const block = b.split(/<\/item>/i)[0];
        const title = tag(block, "title");
        const link = tag(block, "link");
        if (title && link) {
          items.push({
            source: f.name,
            title,
            link,
            description: tag(block, "description"),
            pubDate: tag(block, "pubDate"),
            broad: !!f.broad,
          });
        }
      }
    }
    runs.push({
      run_id: RUN_ID, source: f.name, source_type: "publication", url: f.url,
      mode: "http", via: res.via, http_status: res.status, ok: items.length > 0,
      items_found: items.length, companies_stored: 0,
      duration_ms: Date.now() - t0, error: res.error ?? null,
    });
    console.log(`[feed] ${f.name.padEnd(20)} ${String(items.length).padStart(3)} items (${res.via})`);
    return items;
  });
  return results.flat();
}

async function collectListingItems(): Promise<Item[]> {
  const out: Item[] = [];
  for (const l of LISTINGS) {
    const t0 = Date.now();
    const found = new Set<string>();
    for (let p = 1; p <= Math.min(l.pages, LISTING_PAGES); p++) {
      const url = p === 1 ? l.base : `${l.base}page/${p}/`;
      const res = await smartFetch(url, { mode: "http" });
      if (res.error || res.status >= 400) break;
      for (const m of res.html.match(l.pattern) ?? []) found.add(m);
      await sleep(200);
    }
    runs.push({
      run_id: RUN_ID, source: `${l.name} (listing)`, source_type: "publication", url: l.base,
      mode: "http", via: "http", http_status: 200, ok: found.size > 0,
      items_found: found.size, companies_stored: 0, duration_ms: Date.now() - t0, error: null,
    });
    console.log(`[listing] ${l.name}: ${found.size} article urls`);
    for (const link of found) {
      out.push({ source: l.name, title: "", link, description: "", pubDate: "", broad: false });
    }
  }
  return out;
}

async function runNews(): Promise<number> {
  const seen = new Set<string>();
  const all = [...(await collectFeedItems()), ...(await collectListingItems())];
  const work = all.filter((it) => {
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    // Listing items are already funding-scoped; RSS items get keyword-filtered.
    if (it.title === "") return true;
    if (!FUNDING_RE.test(`${it.title} ${it.description}`)) return false;
    // Pan-European feeds carry a lot of non-UK noise. Require a UK signal in the
    // headline before spending a model call on the article.
    if (it.broad && !/\b(uk|u\.k\.|british|britain|london|cambridge|oxford|manchester|bristol|edinburgh|glasgow|leeds|england|scotland|wales)\b/i.test(`${it.title} ${it.description}`)) {
      return false;
    }
    return true;
  });

  const capped = work.slice(0, MAX_ARTICLES);
  console.log(`[news] ${all.length} items -> ${work.length} relevant -> processing ${capped.length}${work.length > capped.length ? ` (capped by DEALS_MAX_ARTICLES=${MAX_ARTICLES}; ${work.length - capped.length} dropped)` : ""}`);

  let stored = 0;
  await pool(capped, CONCURRENCY, async (w, i) => {
    try {
      const art = await smartFetch(w.link, { mode: "http" });
      const title = w.title || metaContent(art.html, "og:title");
      const body = art.text.slice(0, 6000) || w.description;
      const pub = w.pubDate || metaContent(art.html, "article:published_time");
      if (!body) return;
      const companies = await extract(
        ARTICLE_SYSTEM,
        `SOURCE: ${w.source}\nTITLE: ${title}\nPUBLISHED: ${pub}\n\n${body}`,
        ARTICLE_MODEL,
      );
      const rows = companies
        .filter((c) => c.name && isPlausibleCompanyName(c.name) && !isKnownNonUk(c.hq_country))
        .map((c) => rowFor(c, w.source, "publication", w.link, safeDate(pub), [], ARTICLE_MODEL));
      stored += await upsertCompanies(rows);
      if ((i + 1) % 20 === 0) console.log(`[news] ${i + 1}/${capped.length} articles, ${stored} rows, $${spentUsd().toFixed(3)}`);
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      console.error(`[news] ${w.link}: ${(e as Error).message}`);
    }
  });
  console.log(`[news] DONE — ${stored} company rows`);
  return stored;
}

// --- portfolios -------------------------------------------------------------

async function runPortfolio(p: PortfolioSource): Promise<number> {
  const t0 = Date.now();
  const res = await smartFetch(p.url, { mode: p.mode, render: p.render });

  const push = (ok: boolean, items: number, storedN: number, err: string | null) => {
    runs.push({
      run_id: RUN_ID, source: p.name, source_type: p.sourceType, url: p.url,
      mode: p.mode, via: res.via, http_status: res.status, ok,
      items_found: items, companies_stored: storedN,
      duration_ms: Date.now() - t0, error: err,
    });
  };

  if (res.error) {
    console.log(`[portfolio] ${p.name.padEnd(26)} FAILED (${res.error})`);
    push(false, 0, 0, res.error);
    return 0;
  }

  let stored = 0;
  let items = 0;

  // Names can come from image labels, from detail-page slugs, or both. Merging
  // them before choosing a path means a site that exposes only one still works.
  const gridNames = Array.from(new Set([...res.labels, ...res.slugNames]));

  // Path A — known name list (logo grid and/or detail-page slugs). The alt/title labels ARE the company list, so score them
  // as a known list (LIST_SYSTEM scores every name given, where PORTFOLIO_SYSTEM
  // conservatively skips bare names it cannot place).
  if (gridNames.length >= 12) {
    items = gridNames.length;
    const fresh = RESCORE
      ? gridNames
      : gridNames.filter((l) => !alreadyScored.has(normalizeName(l)));
    const skipped = gridNames.length - fresh.length;
    if (fresh.length === 0) {
      console.log(`[portfolio] ${p.name.padEnd(26)}   0 new (all ${items} labels already scored, ${res.via})`);
      push(true, items, 0, null);
      return 0;
    }
    const batches: string[][] = [];
    for (let i = 0; i < fresh.length; i += LABEL_BATCH) {
      batches.push(fresh.slice(i, i + LABEL_BATCH));
    }
    if (skipped) console.log(`[portfolio] ${p.name}: skipping ${skipped} already-scored labels`);
    for (const batch of batches) {
      try {
        const companies = await extract(
          LIST_SYSTEM,
          `These are ${p.name} portfolio companies. Score every one that is UK-based. Each line is one company:\n\n` +
            batch.map((n) => `- ${n}`).join("\n"),
          BULK_MODEL,
        );
        const rows = companies.filter((c) => c.name && isPlausibleCompanyName(c.name) && !isKnownNonUk(c.hq_country));
        for (const c of rows) alreadyScored.add(normalizeName(c.name));
        stored += await upsertCompanies(
          rows.map((c) => rowFor(c, p.name, p.sourceType, p.url, null, [p.name])),
        );
      } catch (e) {
        if (e instanceof BudgetExceededError) throw e;
        console.error(`[portfolio] ${p.name}: ${(e as Error).message}`);
      }
    }
    console.log(`[portfolio] ${p.name.padEnd(26)} ${String(stored).padStart(3)} companies (names: ${res.labels.length} labels + ${res.slugNames.length} slugs, ${res.via})`);
    push(true, items, stored, null);
    return stored;
  }

  // Path B — names live in the page prose.
  if (res.text.length < 500) {
    console.log(`[portfolio] ${p.name.padEnd(26)} no usable content (${res.text.length} chars, ${res.via})`);
    push(false, 0, 0, `thin content: ${res.text.length} chars`);
    return 0;
  }
  const chunks = chunk(res.text.slice(0, PORTFOLIO_MAX_CHARS), 7_000);
  items = chunks.length;
  for (const ch of chunks) {
    try {
      const companies = await extract(PORTFOLIO_SYSTEM, `SOURCE: ${p.name}\n\n${ch}`, BULK_MODEL);
      stored += await upsertCompanies(
        companies.filter((c) => c.name && isPlausibleCompanyName(c.name) && !isKnownNonUk(c.hq_country)).map((c) => rowFor(c, p.name, p.sourceType, p.url, null, [p.name])),
      );
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      console.error(`[portfolio] ${p.name}: ${(e as Error).message}`);
    }
  }
  console.log(`[portfolio] ${p.name.padEnd(26)} ${String(stored).padStart(3)} companies (text, ${chunks.length} chunks, ${res.via})`);
  push(true, items, stored, null);
  return stored;
}

async function runPortfolios(): Promise<number> {
  const wanted = ONLY_SOURCE.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const list = wanted.length
    ? PORTFOLIOS.filter((p) => wanted.some((w) => p.name.toLowerCase().includes(w)))
    : PORTFOLIOS;
  console.log(`[portfolios] ${list.length} sources`);
  // Headless sources run serially against the shared browser; HTTP ones in parallel.
  const http = list.filter((p) => p.mode !== "headless");
  const headless = list.filter((p) => p.mode === "headless");
  let stored = 0;
  const httpTotals = await pool(http, CONCURRENCY, (p) => runPortfolio(p));
  stored += httpTotals.reduce((a, b) => a + b, 0);
  for (const p of headless) stored += await runPortfolio(p);
  console.log(`[portfolios] DONE — ${stored} company rows`);
  return stored;
}

// --- Y Combinator UK subset -------------------------------------------------

const YC_API = "https://yc-oss.github.io/api/companies/all.json";

interface YcCompany {
  name: string; website: string | null; url: string | null;
  one_liner: string | null; long_description: string | null;
  industry: string | null; subindustry: string | null;
  batch: string | null; stage: string | null; status: string | null;
  all_locations: string | null; regions: string[] | null; launched_at: number | null;
}

function isUk(c: YcCompany): boolean {
  const segs = (c.all_locations ?? "").toLowerCase().split(";");
  const byLoc = segs.some((s) => {
    const t = s.trim();
    return t.endsWith("united kingdom") || t.endsWith("england") || t.endsWith("scotland") || t.endsWith("wales");
  });
  const byRegion = (c.regions ?? []).some((r) => /^(united kingdom|england|scotland|wales)$/i.test(r.trim()));
  return byLoc || byRegion;
}

async function runYc(): Promise<number> {
  const t0 = Date.now();
  const res = await smartFetch(YC_API, { mode: "http" });
  if (res.error || res.status >= 400) {
    console.error(`[yc] directory unavailable (${res.error ?? res.status})`);
    runs.push({
      run_id: RUN_ID, source: "Y Combinator", source_type: "accelerator", url: YC_API,
      mode: "http", via: res.via, http_status: res.status, ok: false,
      items_found: 0, companies_stored: 0, duration_ms: Date.now() - t0,
      error: res.error ?? `HTTP ${res.status}`,
    });
    return 0;
  }
  let all: YcCompany[];
  try {
    all = JSON.parse(res.html) as YcCompany[];
  } catch (e) {
    console.error(`[yc] parse failed: ${(e as Error).message}`);
    return 0;
  }
  const uk = all.filter(isUk).filter((c) => c.status !== "Inactive");
  console.log(`[yc] ${uk.length} live UK companies of ${all.length} total`);

  let stored = 0;
  const BATCH = 6;
  const batches: YcCompany[][] = [];
  for (let i = 0; i < uk.length; i += BATCH) batches.push(uk.slice(i, i + BATCH));

  for (const batch of batches) {
    const byName = new Map(batch.map((c) => [normalizeName(c.name), c]));
    try {
      const companies = await extract(
        LIST_SYSTEM,
        `These are Y Combinator-backed companies headquartered in the United Kingdom. Score each. Each bullet is one company:\n\n` +
          batch
            .map((c) => `- ${c.name} (${c.batch ?? "YC"}, ${c.all_locations ?? "UK"}; ${c.industry ?? ""}/${c.subindustry ?? ""}): ${c.one_liner ?? ""}. ${(c.long_description ?? "").slice(0, 600)}`)
            .join("\n"),
        BULK_MODEL,
      );
      const rows = companies
        .filter((c) => c.name && isPlausibleCompanyName(c.name) && !isKnownNonUk(c.hq_country))
        .map((c) => {
          const src = byName.get(normalizeName(c.name));
          const row = rowFor(
            c, "Y Combinator", "accelerator",
            src?.url || YC_API,
            src?.launched_at != null ? new Date(src.launched_at * 1000).toISOString() : null,
            ["Y Combinator"],
          );
          row.website = c.website || src?.website || null;
          row.description = c.description || src?.one_liner || null;
          row.stage = row.stage || (src?.batch ? `YC ${src.batch}` : src?.stage) || null;
          row.sector = c.sector || src?.industry || null;
          return row;
        });
      stored += await upsertCompanies(rows);
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      console.error(`[yc] batch: ${(e as Error).message}`);
    }
  }
  runs.push({
    run_id: RUN_ID, source: "Y Combinator", source_type: "accelerator", url: YC_API,
    mode: "http", via: res.via, http_status: res.status, ok: true,
    items_found: uk.length, companies_stored: stored,
    duration_ms: Date.now() - t0, error: null,
  });
  console.log(`[yc] DONE — ${stored} company rows`);
  return stored;
}

// --- main -------------------------------------------------------------------

async function main() {
  // Flush whatever we have if the run is interrupted.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, async () => {
      console.log(`\n[deals] ${sig} — flushing source health and exiting`);
      await flushRuns();
      logSummary();
      await closeBrowser();
      process.exit(130);
    });
  }
  console.log(`[deals] run ${RUN_ID} · store=${await backend()}`);
  for (const c of await loadCompanies()) {
    if (c.name_normalized) alreadyScored.add(c.name_normalized);
  }
  console.log(`[deals] ${alreadyScored.size} companies already scored${RESCORE ? " (rescore forced)" : ""}`);
  let total = 0;
  let aborted: string | null = null;
  try {
    if (ONLY === "" || ONLY === "news") { total += await runNews(); await flushRuns(); }
    if (ONLY === "" || ONLY === "portfolios") { total += await runPortfolios(); await flushRuns(); }
    if (ONLY === "" || ONLY === "yc") { total += await runYc(); await flushRuns(); }
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      aborted = e.message;
      console.error(`\n[deals] ABORTED — ${e.message}`);
    } else {
      throw e;
    }
  }

  await flushRuns();
  const ok = runs.filter((r) => r.ok).length;
  const headless = runs.filter((r) => r.via === "headless").length;
  console.log(
    `\n[deals] ${total} company rows · ${ok}/${runs.length} sources OK · ${headless} needed headless`,
  );
  logSummary();
  if (aborted) console.log(`[deals] partial run: ${aborted}`);
  await closeBrowser();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
