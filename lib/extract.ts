// LLM extraction + thesis scoring.
//
// Every source funnels through here: news articles, portfolio grids, accelerator
// cohorts, the YC directory. Three system prompts share one tool schema, and all
// three are cached, which is what makes re-running the crawl cheap.

import { getAnthropic, HAIKU, SONNET } from "./anthropic";
import { assertBudget, record } from "./cost";
import {
  ALUMNI_PROMPT_BLOCK,
  ANTI_PATTERN_BLOCK,
  FUND,
  THESIS_KEYS,
  THESIS_PROMPT_BLOCK,
} from "./fund";

// Do NOT phrase this as "only include UK companies".
//
// Telling a model to omit non-UK companies makes it comply the cheapest way it
// can, which is to relabel: an earlier version of this prompt returned Figma,
// Notion, Roblox and Personio each tagged `hq_city: London`. Asking for the
// truth and filtering in code is far more reliable than asking for a filtered
// truth, because a wrong country is detectable and a silent omission is not.
const GEO_RULE = `Report every company you find, including ones headquartered outside the United Kingdom. Set hq_country to the country of the company's actual global headquarters, using its common English name ("United Kingdom", "United States", "Germany", "Sweden"). Set hq_city to that headquarters city.

This matters more than it looks: a UK investor's portfolio page lists companies from all over the world, and downstream code filters on hq_country. Never label a company as United Kingdom just because it appears on a UK investor's page, and never guess a UK city for a company headquartered elsewhere - Figma is San Francisco, Personio is Munich, Klarna is Stockholm. If you genuinely do not know where a company is headquartered, leave hq_country and hq_city empty rather than guessing.`;

const THESIS_INTRO = `${FUND.name} is a ${FUND.blurb}, investing out of ${FUND.hq}. Score companies on these five dimensions.

${THESIS_PROMPT_BLOCK}

The bar the fund articulates: AI that fundamentally changes a workflow in a way that creates an enduring system, used daily, driving hard-dollar ROI — with retention and usage patterns as the proof, NOT the sophistication of the AI itself.

THESIS MISFITS. Some companies are out of scope no matter how good they are. Set thesis_misfit true and give the matching misfit_reason key when a company is one of these:

${ANTI_PATTERN_BLOCK}

Judging misfits well matters more than judging scores well. A drug-discovery company selling into regulated buyers looks excellent on paper and is still un-investable for this fund, so flag it rather than scoring it highly. Be careful with the healthcare split: clinical documentation, care operations and healthcare back-office software are IN scope; therapeutics, molecule pipelines and preclinical work are NOT.`;

/** News / article extraction: find the deals, then score them. */
export const ARTICLE_SYSTEM = `You are a sourcing analyst at ${FUND.name}, an early-stage venture capital firm in ${FUND.hq}. You read UK and European startup news and (1) extract the companies that have raised funding or are otherwise notable deals, and (2) score each against the ${FUND.name} thesis.

${THESIS_INTRO}

Rules:
- ${GEO_RULE}
- Skip generic market commentary, opinion pieces, award shortlists and event announcements.
- A single article may mention multiple companies (e.g. weekly funding roundups) — extract all qualifying ones.
- If the article has no qualifying UK company, return an empty array.
- Score each durability dimension 1-10 with a note of AT MOST 12 WORDS, and give an overall thesis_fit_score 1-10. Be decisive and use the full range; a thin AI wrapper with no durability should score low even if it raised a lot.
- fund_overlap: list any of these ${FUND.name} portfolio companies appearing as an investor, a co-investor, or an employer a founder came from: ${ALUMNI_PROMPT_BLOCK}.
- hq_country / hq_city: the actual headquarters, per the reporting rule above.
- summary: at most 2 short lines on why this is or isn't interesting for ${FUND.name}.`;

/** Known-list scoring: score every company given, no funding event required. */
export const LIST_SYSTEM = `You are a sourcing analyst at ${FUND.name}, an early-stage venture capital firm in ${FUND.hq}. You are given a list of known UK companies backed by an investor or accelerator. Score EVERY company in the list. Do NOT skip any, and do NOT require a funding event.

${THESIS_INTRO}

For each company return: name (exactly as given), ai_native (true only if the product is fundamentally AI), sector, a 1-10 score + a note of at most 12 words per durability dimension, an overall thesis_fit_score 1-10 (be decisive, use the full range), fund_overlap (any of: ${ALUMNI_PROMPT_BLOCK}), hq_country and hq_city per the reporting rule, and a summary of at most 2 short lines. Leave amount_raised and stage empty if unknown.

${GEO_RULE}`;

/** Free-text portfolio page: find the companies in the prose, then score them. */
export const PORTFOLIO_SYSTEM = `You are given raw text scraped from a venture capital, accelerator or university PORTFOLIO page. Extract every distinct portfolio COMPANY listed. Ignore navigation, team members, fund names, blog post titles, footers, generic words and award names. Only include things that are clearly real startups.

${THESIS_INTRO}

For each company return name, a short description if discernible (else empty), ai_native (true only if fundamentally AI), sector if discernible, a 1-10 score + a note of at most 12 words per dimension, overall thesis_fit_score 1-10 (be decisive), fund_overlap (any of: ${ALUMNI_PROMPT_BLOCK}), hq_country and hq_city per the reporting rule, and a summary of at most 2 short lines. Leave stage/amount empty.

${GEO_RULE}

If the page contains no real companies at all, return an empty array.`;

const dim = {
  type: "object" as const,
  properties: {
    score: { type: "integer", minimum: 1, maximum: 10 },
    note: { type: "string", description: "At most 12 words. No preamble." },
  },
  required: ["score", "note"],
};

const breakdownProps = Object.fromEntries(THESIS_KEYS.map((k) => [k, dim]));

export const RECORD_TOOL = {
  name: "record_companies",
  description: "Record the UK companies found, scored against the fund's durability thesis.",
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
            hq_country: { type: "string", description: "Country of the actual global HQ, common English name. Empty if genuinely unknown." },
            hq_city: { type: "string", description: "City of the actual global HQ. Empty if genuinely unknown." },
            ai_native: { type: "boolean" },
            amount_raised: { type: "string", description: "e.g. £3.5M, or empty string" },
            investors: { type: "array", items: { type: "string" } },
            founders: { type: "array", items: { type: "string" } },
            thesis_fit_score: { type: "integer", minimum: 1, maximum: 10 },
            thesis_breakdown: {
              type: "object",
              properties: breakdownProps,
              required: [...THESIS_KEYS],
            },
            fund_overlap: { type: "array", items: { type: "string" } },
            thesis_misfit: {
              type: "boolean",
              description: "True if the company matches one of the stated anti-patterns.",
            },
            misfit_reason: {
              type: "string",
              description: 'One of: drug_discovery, ai_productivity_tool, pure_hardware, pure_consumer. Empty if not a misfit.',
            },
            summary: { type: "string" },
          },
          required: ["name", "ai_native", "hq_country", "thesis_fit_score", "thesis_breakdown", "thesis_misfit", "summary"],
        },
      },
    },
    required: ["companies"],
  },
};

export interface ExtractedCompany {
  name: string;
  website?: string;
  description?: string;
  stage?: string;
  sector?: string;
  hq_country?: string;
  hq_city?: string;
  ai_native?: boolean;
  amount_raised?: string;
  investors?: string[];
  founders?: string[];
  thesis_fit_score?: number;
  thesis_breakdown?: unknown;
  fund_overlap?: string[];
  thesis_misfit?: boolean;
  misfit_reason?: string;
  summary?: string;
}

/**
 * Run one extraction pass. The system prompt is cached (it is ~2KB of thesis and
 * alumni text repeated on every call), so re-runs mostly pay the 0.1x cache read.
 */
export async function extract(
  system: string,
  content: string,
  model: string = SONNET,
): Promise<ExtractedCompany[]> {
  assertBudget();
  const anthropic = getAnthropic();
  const msg = await anthropic.messages.create({
    model,
    // Generous, because the failure mode is silent. If the response hits the
    // cap mid-tool-call the JSON never closes, `input` comes back empty, and the
    // batch is dropped with no error — a whole crawl once stored zero rows this
    // way. Better to over-provision and check stop_reason.
    max_tokens: 16_000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_companies" },
    messages: [{ role: "user", content }],
  });
  record(model, msg.usage);
  if (msg.stop_reason === "max_tokens") {
    console.warn(
      `[extract] response hit max_tokens (${msg.usage.output_tokens} out) — the tool call is ` +
        `truncated and this batch is lost. Reduce the batch/chunk size.`,
    );
  }
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  const input = toolUse.input as { companies?: ExtractedCompany[] };
  if (!Array.isArray(input.companies)) {
    console.warn(`[extract] tool call returned no usable companies array (stop_reason=${msg.stop_reason})`);
    return [];
  }
  return input.companies;
}

/** Dedupe key. Strips legal suffixes and punctuation. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|llc|plc|co|holdings|group)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Bulk list/grid scoring is shallow per record — Haiku is the right tier. */
export const BULK_MODEL = HAIKU;
/** Prose extraction from articles needs the stronger reader. */
export const ARTICLE_MODEL = SONNET;

/**
 * Reject extraction artefacts that are descriptions rather than company names.
 *
 * When an article mentions an unnamed company ("a Macmillan-backed AI diagnostic
 * startup"), the model will sometimes put that phrase in the `name` field. Those
 * rows are unusable — they cannot be deduped, looked up, or contacted — so they
 * are dropped rather than stored.
 */
export function isPlausibleCompanyName(name: string): boolean {
  // A trailing acronym is part of the name ("Lift Me Off (LMO)"), not a
  // description, so strip it before judging rather than rejecting outright.
  const n = name.trim().replace(/\s*\([A-Z0-9&.-]{2,8}\)$/, "").trim();
  if (n.length < 2 || n.length > 40) return false;
  // Any remaining parenthetical is a qualifier, i.e. a description marker.
  if (/[()[\]]/.test(n)) return false;
  if (/\b(startup|start-up|company|firm|business|venture|platform|group of|unnamed|undisclosed|stealth)\b/i.test(n)) {
    return false;
  }
  // Descriptions run long and read as a sentence; real names rarely exceed 4 words.
  if (n.split(/\s+/).length > 4) return false;
  // Must contain a letter and start like a name, not a sentence fragment.
  if (!/[a-z]/i.test(n)) return false;
  if (/^(a|an|the|its|their|this|that)\s/i.test(n)) return false;
  return true;
}

/** Countries we treat as in scope for a UK radar. */
const UK_NAMES =
  /^(united kingdom|uk|u\.k\.|great britain|britain|england|scotland|wales|northern ireland|gb)$/i;

export function isUkCountry(country: string | null | undefined): boolean {
  return !!country && UK_NAMES.test(country.trim());
}

/**
 * The ingest filter. Drops a company only when the model has CONFIDENTLY placed
 * it outside the UK.
 *
 * Filtering on `isUkCountry` instead looks equivalent and is not: a portfolio
 * grid gives the model bare company names with no context, so it correctly
 * reports an empty country for most of them, and a positive UK test then throws
 * away the whole page. That mistake cost a full crawl that stored zero rows.
 *
 * Unknown-origin rows are kept and left to the verification pass
 * (scripts/verify-geo.ts), which asks about each name specifically and can be
 * re-run cheaply. Keeping a non-UK company is a visible, fixable error; dropping
 * a UK one is silent and unrecoverable.
 */
export function isKnownNonUk(country: string | null | undefined): boolean {
  const c = (country ?? "").trim();
  if (!c || /^(unknown|n\/a|none|unclear|not stated)$/i.test(c)) return false;
  return !UK_NAMES.test(c);
}
