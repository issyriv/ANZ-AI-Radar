import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import { getAnthropic, HAIKU } from "../lib/anthropic";
import { AIRTREE_ALUMNI } from "../lib/config";
import { sleep } from "../lib/github";

const PAGES = Number(process.env.DEALS_PAGES ?? 10);
// How much of a portfolio page to read. Big grids (e.g. Blackbird) overflowed the
// old 30k cap and lost most companies; labels are now front-loaded so they survive.
const PORTFOLIO_MAX_CHARS = Number(process.env.PORTFOLIO_MAX_CHARS ?? 60000);

// RSS feeds (source_type: publication) — catch the very latest.
const FEEDS = [
  { name: "Startup Daily", url: "https://www.startupdaily.net/topic/funding/feed/" },
  { name: "Startup Daily", url: "https://www.startupdaily.net/feed/" },
  { name: "SmartCompany", url: "https://www.smartcompany.com.au/feed/" },
  { name: "InnovationAus", url: "https://www.innovationaus.com/feed/" },
];

// Static portfolio pages (company list is in the HTML; extracted by the LLM from
// the page text, which is robust to per-site DOM differences). JS-rendered sites
// (Antler, Main Sequence, Icehouse, etc.) are NOT here — they need a headless browser.
const STATIC_PORTFOLIOS: { name: string; source_type: string; url: string }[] = [
  { name: "Blackbird Ventures", source_type: "vc_portfolio", url: "https://www.blackbird.vc/portfolio" },
  { name: "Folklore Ventures", source_type: "vc_portfolio", url: "https://folklore.vc/portfolio" },
  { name: "Investible", source_type: "vc_portfolio", url: "https://investible.com/portfolio" },
  // Added after probing for static (non-JS) company content; verified to serve
  // their real holdings in the initial HTML.
  { name: "Airtree Ventures", source_type: "vc_portfolio", url: "https://www.airtree.vc/portfolio" },
  { name: "Square Peg", source_type: "vc_portfolio", url: "https://www.squarepeg.vc/companies" },
  { name: "Tenacious Ventures", source_type: "vc_portfolio", url: "https://tenacious.ventures/portfolio" },
  { name: "Our Innovation Fund", source_type: "vc_portfolio", url: "https://www.ourinnovationfund.com.au/portfolio" },
  { name: "Skalata Ventures", source_type: "accelerator", url: "https://www.skalata.co/portfolio" },
  { name: "EnergyLab", source_type: "accelerator", url: "https://energylab.org.au/startups/" },
  { name: "Cicada Innovations", source_type: "accelerator", url: "https://www.cicadainnovations.com/portfolio" },
  { name: "UNSW Founders", source_type: "university", url: "https://www.founders.unsw.edu.au" },
  { name: "UniQuest (UQ)", source_type: "university", url: "https://uniquest.com.au" },
];

// Listing pages crawled for history/depth (article URLs extracted by pattern).
const LISTINGS = [
  { name: "Startup Daily", base: "https://www.startupdaily.net/topic/funding/", pages: PAGES },
];
const SD_ARTICLE_RE = /https:\/\/www\.startupdaily\.net\/topic\/[a-z0-9-]+\/[a-z0-9-]{12,}\//g;

const FUNDING_RE =
  /\b(raise[sd]?|raising|funding|seed|series\s+[a-d]\b|pre-?seed|backed|invest(s|ed|ment)?|round|capital raise|\$\s?\d|grant|valuation|acqui)/i;

const ALUMNI_NAMES = AIRTREE_ALUMNI.map((a) => a.name);
const UA = "Mozilla/5.0 anz-ai-radar/1.0";

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&#0?39;|&apos;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "...")
    .trim();
}
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}
function stripHtml(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}
function safeDate(s: string): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
// Order-independent <meta> content extraction (handles content-before-property).
function metaContent(html: string, prop: string): string {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${esc}["'][^>]*>`, "i"));
  if (!t) return "";
  const c = t[0].match(/content=["']([^"']*)["']/i);
  return c ? decode(c[1]) : "";
}

interface FeedItem {
  source: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

async function fetchFeed(name: string, url: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`[feed] ${url}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return xml
      .split(/<item>/i)
      .slice(1)
      .map((b) => {
        const block = b.split(/<\/item>/i)[0];
        return {
          source: name,
          title: tag(block, "title"),
          link: tag(block, "link"),
          description: stripHtml(tag(block, "description")),
          pubDate: tag(block, "pubDate"),
        };
      })
      .filter((it) => it.title && it.link);
  } catch (e) {
    console.error(`[feed] ${url}: ${(e as Error).message}`);
    return [];
  }
}

async function collectListingUrls(name: string, base: string, pages: number): Promise<{ source: string; link: string }[]> {
  const found = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? base : `${base}page/${p}/`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) break;
      const html = await res.text();
      for (const m of html.match(SD_ARTICLE_RE) ?? []) found.add(m);
    } catch (e) {
      console.error(`[listing] ${url}: ${(e as Error).message}`);
      break;
    }
    await sleep(200);
  }
  return [...found].map((link) => ({ source: name, link }));
}

async function fetchArticle(url: string): Promise<{ text: string; publishedAt: string; title: string }> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { text: "", publishedAt: "", title: "" };
    const html = await res.text();
    const pub = metaContent(html, "article:published_time");
    const title = metaContent(html, "og:title");
    return { text: stripHtml(html).slice(0, 6000), publishedAt: pub, title };
  } catch {
    return { text: "", publishedAt: "", title: "" };
  }
}

const SYSTEM = `You are a sourcing analyst at Airtree, an early-stage VC in Sydney. You read ANZ startup news and (1) extract the companies that have raised funding or are otherwise notable deals, and (2) score each against Airtree's AI durability thesis.

Thesis: AI-native ARR is often mis-classified as durable SaaS. The durable subset has at least one of:
- switching_cost: embedded in a workflow that is painful to rip out
- proprietary_data: accumulates proprietary data that compounds with use
- regulated_trust: sells into regulated/high-trust buyers (legal, health, finance, gov) where credibility takes years
- distribution: durable distribution not dependent on the next foundation model staying mediocre

Rules:
- Only include Australia / New Zealand companies. Skip overseas companies, generic market commentary, opinion pieces, and award/event announcements.
- A single article may mention multiple companies (e.g. weekly funding roundups) — extract all qualifying ones.
- If the article has no qualifying ANZ company, return an empty array.
- Score each durability dimension 1-10 with a one-line note, and give an overall thesis_fit_score 1-10. Be decisive and use the full range; a thin AI wrapper with no durability should score low even if it raised a lot.
- airtree_overlap: list any of these Airtree portfolio/alumni names appearing as investors, or where a founder is ex-employee: ${ALUMNI_NAMES.join(", ")}.
- summary: 1-2 lines on why this is or isn't interesting for Airtree.`;

const SCORE_SYSTEM = `You are a sourcing analyst at Airtree, an early-stage VC in Sydney. You are given a list of known ANZ early-stage companies (accelerator-backed, typically pre-seed or seed). Score EVERY company in the list against Airtree's AI durability thesis. Do NOT skip any, and do NOT require a funding event.

Durability thesis — the durable subset has at least one of:
- switching_cost: embedded in a workflow that is painful to rip out
- proprietary_data: accumulates proprietary data that compounds with use
- regulated_trust: sells into regulated/high-trust buyers (legal, health, finance, gov)
- distribution: durable distribution not dependent on the next foundation model staying mediocre

For each company return: name (exactly as given), ai_native (true only if the product is fundamentally AI), sector, a 1-10 score + one-line note per durability dimension, an overall thesis_fit_score 1-10 (be decisive, use the full range), airtree_overlap (any of: ${ALUMNI_NAMES.join(", ")}), and a 1-2 line summary. Leave amount_raised and stage empty if unknown.`;

const PORTFOLIO_SYSTEM = `You are given raw text scraped from a venture capital or accelerator PORTFOLIO page. Extract every distinct Australian or New Zealand PORTFOLIO COMPANY listed. Ignore navigation, team members, fund names, blog post titles, footers, generic words, and non-ANZ companies. Only include things that are clearly real startups.

For each company, score it on Airtree's AI durability thesis:
- switching_cost: embedded in a workflow that is painful to rip out
- proprietary_data: accumulates proprietary data that compounds with use
- regulated_trust: sells into regulated/high-trust buyers (legal, health, finance, gov)
- distribution: durable distribution not dependent on the next foundation model staying mediocre

Return name, a short description if discernible (else empty), ai_native (true only if fundamentally AI), sector if discernible, a 1-10 score + one-line note per dimension, overall thesis_fit_score 1-10 (be decisive), airtree_overlap (any of: ${ALUMNI_NAMES.join(", ")}), and a 1-2 line summary. Leave stage/amount empty. If you cannot identify any real ANZ company, return an empty array.`;

const dim = {
  type: "object" as const,
  properties: { score: { type: "integer", minimum: 1, maximum: 10 }, note: { type: "string" } },
  required: ["score", "note"],
};

const TOOL = {
  name: "record_companies",
  description: "Record ANZ companies found in this article, scored vs the durability thesis.",
  input_schema: {
    type: "object" as const,
    properties: {
      companies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            website: { type: "string", description: "domain if known, else empty string" },
            description: { type: "string" },
            stage: { type: "string", description: "pre-seed/seed/series a/grant/unknown" },
            sector: { type: "string" },
            ai_native: { type: "boolean" },
            amount_raised: { type: "string", description: "e.g. $3.5M, or empty string" },
            investors: { type: "array", items: { type: "string" } },
            founders: { type: "array", items: { type: "string" } },
            thesis_fit_score: { type: "integer", minimum: 1, maximum: 10 },
            thesis_breakdown: {
              type: "object",
              properties: {
                switching_cost: dim,
                proprietary_data: dim,
                regulated_trust: dim,
                distribution: dim,
              },
              required: ["switching_cost", "proprietary_data", "regulated_trust", "distribution"],
            },
            airtree_overlap: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
          required: ["name", "ai_native", "thesis_fit_score", "thesis_breakdown", "summary"],
        },
      },
    },
    required: ["companies"],
  },
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|llc|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ExtractedCompany {
  name: string;
  website?: string;
  description?: string;
  stage?: string;
  sector?: string;
  ai_native?: boolean;
  amount_raised?: string;
  investors?: string[];
  founders?: string[];
  thesis_fit_score?: number;
  thesis_breakdown?: unknown;
  airtree_overlap?: string[];
  summary?: string;
}

async function extract(
  source: string,
  title: string,
  pubDate: string,
  body: string,
  system: string = SYSTEM,
): Promise<ExtractedCompany[]> {
  const anthropic = getAnthropic();
  const content = `SOURCE: ${source}\nTITLE: ${title}\nPUBLISHED: ${pubDate}\n\n${body}`;
  const msg = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 8000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_companies" },
    messages: [{ role: "user", content }],
  });
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  const input = toolUse.input as { companies?: ExtractedCompany[] };
  return Array.isArray(input.companies) ? input.companies : [];
}

// --- Accelerator source: Startmate (all ANZ, pre-seed/seed) ---
const STARTMATE_PORTFOLIO = "https://www.startmate.com/portfolio";

async function fetchStartmateCompanies(): Promise<{ name: string; description: string; url: string }[]> {
  const res = await fetch(STARTMATE_PORTFOLIO, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error(`[startmate] portfolio HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();
  const slugs = Array.from(new Set(html.match(/\/portfolio-companies\/[a-z0-9-]+/g) ?? []));
  console.log(`[startmate] ${slugs.length} portfolio companies`);
  const out: { name: string; description: string; url: string }[] = [];
  for (const slug of slugs) {
    const url = `https://www.startmate.com${slug}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const h = await r.text();
      const title = metaContent(h, "og:title");
      const desc = metaContent(h, "og:description");
      const name = title.replace(/\s*\|\s*Startmate.*$/i, "").trim();
      if (name) out.push({ name, description: desc, url });
    } catch {
      /* skip */
    }
    await sleep(60);
  }
  return out;
}

async function ingestStartmate(sb: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const cos = await fetchStartmateCompanies();
  const byName = new Map(cos.map((c) => [normalizeName(c.name), c]));
  let stored = 0;
  const BATCH = 6;
  for (let i = 0; i < cos.length; i += BATCH) {
    const batch = cos.slice(i, i + BATCH);
    const text =
      `These are Startmate accelerator portfolio companies, all Australian/New Zealand and typically pre-seed or seed stage. Extract and score each on the durability thesis. Each bullet is one company:\n\n` +
      batch.map((c) => `- ${c.name}: ${c.description}`).join("\n");
    let companies;
    try {
      companies = await extract("Startmate", "Startmate portfolio", "", text, SCORE_SYSTEM);
    } catch (e) {
      console.error(`[startmate] batch ${i}: ${(e as Error).message}`);
      continue;
    }
    for (const c of companies) {
      if (!c.name) continue;
      const src = byName.get(normalizeName(c.name));
      const row = {
        name: c.name,
        name_normalized: normalizeName(c.name),
        website: c.website || null,
        description: c.description || src?.description || null,
        stage: c.stage || "Pre-seed/Seed",
        sector: c.sector || null,
        ai_native: !!c.ai_native,
        amount_raised: c.amount_raised || null,
        investors: c.investors ?? [],
        founders: c.founders ?? [],
        source: "Startmate",
        source_type: "accelerator",
        source_url: src?.url || STARTMATE_PORTFOLIO,
        source_published_at: null,
        thesis_fit_score: c.thesis_fit_score ?? null,
        thesis_breakdown: c.thesis_breakdown ?? null,
        airtree_overlap: c.airtree_overlap ?? [],
        summary: c.summary || null,
        scoring_model: HAIKU,
        scored_at: new Date().toISOString(),
        raw_extract: c,
      };
      const { error } = await sb.from("companies").upsert(row, { onConflict: "name_normalized" });
      if (error) console.error(`[startmate upsert] ${c.name}: ${error.message}`);
      else stored++;
    }
    console.log(`[startmate] batch ${i / BATCH + 1}: total stored ${stored}`);
    await sleep(120);
  }
  console.log(`[startmate] DONE — ${stored} companies`);
  return stored;
}

// --- Accelerator source: Y Combinator (ANZ companies only) ---
// yc-oss/api publishes the full YC directory as JSON (refreshed daily). We pull
// all companies and keep the ANZ subset by country in `all_locations`/`regions`.
const YC_API = "https://yc-oss.github.io/api/companies/all.json";

interface YcCompany {
  name: string;
  website: string | null;
  url: string | null; // YC profile page
  one_liner: string | null;
  long_description: string | null;
  industry: string | null;
  subindustry: string | null;
  batch: string | null;
  stage: string | null; // "Early" | "Growth"
  status: string | null;
  all_locations: string | null;
  regions: string[] | null;
  launched_at: number | null; // unix seconds
}

function isAnz(c: YcCompany): boolean {
  const segs = (c.all_locations ?? "").toLowerCase().split(";");
  const byLoc = segs.some(
    (s) => s.trim().endsWith("australia") || s.trim().endsWith("new zealand"),
  );
  const byRegion = (c.regions ?? []).some((r) =>
    /^(australia|new zealand)$/i.test(r.trim()),
  );
  return byLoc || byRegion;
}

async function fetchYcAnzCompanies(): Promise<YcCompany[]> {
  const res = await fetch(YC_API, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error(`[yc] directory HTTP ${res.status}`);
    return [];
  }
  const all = (await res.json()) as YcCompany[];
  const anz = all.filter(isAnz);
  // Drop companies YC has marked dead — they're not live sourcing targets.
  const live = anz.filter((c) => c.status !== "Inactive");
  console.log(
    `[yc] ${live.length} live ANZ companies (${anz.length - live.length} inactive skipped) of ${all.length} total`,
  );
  return live;
}

async function ingestYc(sb: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const cos = await fetchYcAnzCompanies();
  const byName = new Map(cos.map((c) => [normalizeName(c.name), c]));
  let stored = 0;
  const BATCH = 6;
  for (let i = 0; i < cos.length; i += BATCH) {
    const batch = cos.slice(i, i + BATCH);
    const text =
      `These are Y Combinator-backed companies headquartered (or co-located) in Australia/New Zealand. Extract and score each on the durability thesis. Each bullet is one company:\n\n` +
      batch
        .map((c) =>
          `- ${c.name} (${c.batch ?? "YC"}, ${c.all_locations ?? "ANZ"}; ${c.industry ?? ""}/${c.subindustry ?? ""}): ${c.one_liner ?? ""}. ${(c.long_description ?? "").slice(0, 600)}`,
        )
        .join("\n");
    let companies;
    try {
      companies = await extract("Y Combinator", "YC ANZ companies", "", text, SCORE_SYSTEM);
    } catch (e) {
      console.error(`[yc] batch ${i}: ${(e as Error).message}`);
      continue;
    }
    for (const c of companies) {
      if (!c.name) continue;
      const src = byName.get(normalizeName(c.name));
      const launched =
        src?.launched_at != null ? new Date(src.launched_at * 1000).toISOString() : null;
      // The model sometimes returns the literal "unknown"; prefer the YC batch label.
      const llmStage = c.stage && !/^unknown$/i.test(c.stage) ? c.stage : "";
      const row = {
        name: c.name,
        name_normalized: normalizeName(c.name),
        website: c.website || src?.website || null,
        description: c.description || src?.one_liner || null,
        stage: llmStage || (src?.batch ? `YC ${src.batch}` : src?.stage) || null,
        sector: c.sector || src?.industry || null,
        ai_native: !!c.ai_native,
        amount_raised: c.amount_raised || null,
        investors: c.investors?.length ? c.investors : ["Y Combinator"],
        founders: c.founders ?? [],
        source: "Y Combinator",
        source_type: "accelerator",
        source_url: src?.url || YC_API,
        source_published_at: launched,
        thesis_fit_score: c.thesis_fit_score ?? null,
        thesis_breakdown: c.thesis_breakdown ?? null,
        airtree_overlap: c.airtree_overlap ?? [],
        summary: c.summary || null,
        scoring_model: HAIKU,
        scored_at: new Date().toISOString(),
        raw_extract: c,
      };
      const { error } = await sb.from("companies").upsert(row, { onConflict: "name_normalized" });
      if (error) console.error(`[yc upsert] ${c.name}: ${error.message}`);
      else stored++;
    }
    console.log(`[yc] batch ${i / BATCH + 1}: total stored ${stored}`);
    await sleep(120);
  }
  console.log(`[yc] DONE — ${stored} companies`);
  return stored;
}

function chunkText(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// Generic static-portfolio scraper: fetch page, strip to text, let the LLM pull
// the ANZ companies out of the text (robust to per-site DOM differences).
async function ingestPortfolioPage(
  sb: ReturnType<typeof getSupabaseAdmin>,
  name: string,
  sourceType: string,
  url: string,
): Promise<number> {
  let html = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      console.error(`[portfolio] ${name}: HTTP ${r.status}`);
      return 0;
    }
    html = await r.text();
  } catch (e) {
    console.error(`[portfolio] ${name}: ${(e as Error).message}`);
    return 0;
  }
  // Logo/image alt + title labels — portfolio grids put the company name there
  // rather than in visible text.
  const labelList = Array.from(
    new Set(Array.from(html.matchAll(/(?:alt|title)="([^"]{2,60})"/gi), (m) => m[1].trim())),
  ).filter((l) => l && !/logo|icon|menu|arrow|close|search|^image$/i.test(l));

  // Shared upsert for one extracted/scored company.
  const store = async (c: ExtractedCompany): Promise<boolean> => {
    if (!c.name) return false;
    const row = {
      name: c.name,
      name_normalized: normalizeName(c.name),
      website: c.website || null,
      description: c.description || null,
      stage: c.stage || null,
      sector: c.sector || null,
      ai_native: !!c.ai_native,
      amount_raised: c.amount_raised || null,
      investors: [name],
      founders: c.founders ?? [],
      source: name,
      source_type: sourceType,
      source_url: url,
      source_published_at: null,
      thesis_fit_score: c.thesis_fit_score ?? null,
      thesis_breakdown: c.thesis_breakdown ?? null,
      airtree_overlap: c.airtree_overlap ?? [],
      summary: c.summary || null,
      scoring_model: HAIKU,
      scored_at: new Date().toISOString(),
      raw_extract: c,
    };
    const { error } = await sb.from("companies").upsert(row, { onConflict: "name_normalized" });
    if (error) {
      console.error(`[portfolio upsert] ${c.name}: ${error.message}`);
      return false;
    }
    return true;
  };

  let stored = 0;

  // Path A — logo grid: the labels ARE the company list. Score them as a known
  // list with SCORE_SYSTEM, which scores every name. (Dumping a bare name list at
  // PORTFOLIO_SYSTEM made the model conservatively skip names it couldn't place,
  // which is why Blackbird/Square Peg/Our Innovation Fund came back near-empty.)
  if (labelList.length >= 15) {
    const BATCH = 15;
    for (let i = 0; i < labelList.length; i += BATCH) {
      const batch = labelList.slice(i, i + BATCH);
      const text =
        `These are ${name} portfolio companies, all Australian/New Zealand. Score EVERY one on the durability thesis. Each line is one company:\n\n` +
        batch.map((n) => `- ${n}`).join("\n");
      let companies;
      try {
        companies = await extract(name, `${name} portfolio`, "", text, SCORE_SYSTEM);
      } catch (e) {
        console.error(`[portfolio] ${name}: ${(e as Error).message}`);
        continue;
      }
      for (const c of companies) if (await store(c)) stored++;
      await sleep(150);
    }
    console.log(`[portfolio] ${name}: ${stored} companies (logo grid, ${labelList.length} labels)`);
    return stored;
  }

  // Path B — names in the visible text: extract from the page prose.
  const text = stripHtml(html);
  if (text.length < 300) {
    console.log(`[portfolio] ${name}: no static content (JS-rendered?), skipping`);
    return 0;
  }
  const chunks = chunkText(text.slice(0, PORTFOLIO_MAX_CHARS), 10000);
  for (const ch of chunks) {
    let companies;
    try {
      companies = await extract(name, `${name} portfolio`, "", ch, PORTFOLIO_SYSTEM);
    } catch (e) {
      console.error(`[portfolio] ${name}: ${(e as Error).message}`);
      continue;
    }
    for (const c of companies) if (await store(c)) stored++;
    await sleep(150);
  }
  console.log(`[portfolio] ${name}: ${stored} companies`);
  return stored;
}

interface Work {
  source: string;
  link: string;
  title: string;
  description: string;
  pubDate: string;
  fromListing: boolean;
}

async function main() {
  const sb = getSupabaseAdmin();
  const ONLY = process.env.DEALS_ONLY ?? ""; // "news" | "accel" | "startmate" | "yc" | "portfolios" | "" = all

  if (ONLY === "" || ONLY === "news") {
  const seen = new Set<string>();
  const work: Work[] = [];
  for (const f of FEEDS) {
    for (const it of await fetchFeed(f.name, f.url)) {
      if (!seen.has(it.link)) {
        seen.add(it.link);
        work.push({ ...it, fromListing: false });
      }
    }
  }
  for (const l of LISTINGS) {
    for (const u of await collectListingUrls(l.name, l.base, l.pages)) {
      if (!seen.has(u.link)) {
        seen.add(u.link);
        work.push({ source: u.source, link: u.link, title: "", description: "", pubDate: "", fromListing: true });
      }
    }
  }
  console.log(`[deals] ${work.length} unique items (RSS + ${PAGES} listing pages)`);

  // RSS items keyword-filtered; listing items already funding-scoped.
  const relevant = work.filter((w) => w.fromListing || FUNDING_RE.test(`${w.title} ${w.description}`));
  console.log(`[deals] processing ${relevant.length} items`);

  let stored = 0;
  let processed = 0;
  for (const w of relevant) {
    try {
      const art = await fetchArticle(w.link);
      const title = w.title || art.title;
      const body = art.text || w.description;
      const pub = w.pubDate || art.publishedAt;
      if (!body) continue;
      const companies = await extract(w.source, title, pub, body);
      for (const c of companies) {
        if (!c.name) continue;
        const row = {
          name: c.name,
          name_normalized: normalizeName(c.name),
          website: c.website || null,
          description: c.description || null,
          stage: c.stage || null,
          sector: c.sector || null,
          ai_native: !!c.ai_native,
          amount_raised: c.amount_raised || null,
          investors: c.investors ?? [],
          founders: c.founders ?? [],
          source: w.source,
          source_type: "publication",
          source_url: w.link,
          source_published_at: safeDate(pub),
          thesis_fit_score: c.thesis_fit_score ?? null,
          thesis_breakdown: c.thesis_breakdown ?? null,
          airtree_overlap: c.airtree_overlap ?? [],
          summary: c.summary || null,
          scoring_model: HAIKU,
          scored_at: new Date().toISOString(),
          raw_extract: c,
        };
        const { error } = await sb.from("companies").upsert(row, { onConflict: "name_normalized" });
        if (error) {
          console.error(`[upsert] ${c.name}: ${error.message}`);
          continue;
        }
        stored++;
      }
      processed++;
      if (processed % 10 === 0) console.log(`[deals] processed ${processed}/${relevant.length}, stored ${stored}`);
      await sleep(120);
    } catch (e) {
      console.error(`[skip] ${w.link}: ${(e as Error).message}`);
    }
  }
  console.log(`[deals] news DONE — stored/updated ${stored} company rows from ${processed} articles.`);
  }

  if (ONLY === "" || ONLY === "accel" || ONLY === "startmate") await ingestStartmate(sb);
  if (ONLY === "" || ONLY === "accel" || ONLY === "yc") await ingestYc(sb);
  if (ONLY === "" || ONLY === "portfolios") {
    for (const p of STATIC_PORTFOLIOS) await ingestPortfolioPage(sb, p.name, p.source_type, p.url);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
