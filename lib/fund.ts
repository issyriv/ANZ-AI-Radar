// The fund this radar is pointed at: Northzone.
//
// Northzone is a multi-stage European fund (London / New York / Stockholm /
// Berlin / Amsterdam, founded 1996) whose signature outcomes — Spotify, Klarna,
// Trustpilot, Zettle, Kahoot!, Personio, TrueLayer — are category-defining
// companies built in Europe that then exported globally. That pattern is what
// the fifth scoring dimension below encodes, and it is the thing that makes this
// a Northzone radar rather than a generic AI-startup list.
//
// The alumni list is not hardcoded: it is derived from Northzone's own live
// portfolio page via `npx tsx scripts/fund-sync.ts`, which writes
// lib/fund-portfolio.json. Regenerate it when the portfolio changes.

import portfolio from "./fund-portfolio.json";

export const FUND = {
  name: "Northzone",
  hq: "London",
  region: "the UK and Ireland",
  regionShort: "UK",
  blurb:
    "multi-stage European venture fund, seed to growth, backing category-defining companies since 1996",
} as const;

export interface FundCompany {
  name: string;
  slug: string;
  status: string | null;
  stage: string | null;
  industries: string[];
  countries: string[];
}

export const FUND_PORTFOLIO = portfolio.companies as FundCompany[];
export const FUND_PORTFOLIO_SYNCED_AT = portfolio.synced_at as string;

/** Every portfolio + alumni company name, for overlap detection. */
export const FUND_ALUMNI_NAMES: string[] = FUND_PORTFOLIO.map((c) => c.name);

/** The UK slice — the companies whose ex-employees are most likely to surface locally. */
export const FUND_UK_PORTFOLIO = FUND_PORTFOLIO.filter((c) =>
  c.countries.includes("United Kingdom"),
);

/**
 * The subset we put in prompts. Sending 143 names inflates every request and
 * dilutes the model's attention, so we prioritise the ones an ex-employee or
 * co-investor is realistically going to be named against: the marquee outcomes,
 * then the UK portfolio, then anything AI-tagged.
 */
const MARQUEE = [
  "Spotify", "Klarna", "Trustpilot", "Zettle", "Kahoot!", "Personio", "TrueLayer",
  "Zopa", "Hopin", "Avito", "Einride", "Wallapop", "Catawiki", "TIER", "Jasper",
  "Black Forest Labs", "Xbow", "CuspAI", "Spring Health", "Finom",
];

export const FUND_PROMPT_ALUMNI: string[] = Array.from(
  new Set([
    ...MARQUEE.filter((m) => FUND_ALUMNI_NAMES.includes(m)),
    ...FUND_UK_PORTFOLIO.map((c) => c.name),
    ...FUND_PORTFOLIO.filter((c) => c.industries.includes("AI")).map((c) => c.name),
  ]),
);

/**
 * Aliases for deterministic matching against a bio / company field / email
 * domain. Generated from the portfolio names, plus a few hand-added domains
 * where the company name and domain differ.
 */
const EXTRA_ALIASES: Record<string, string[]> = {
  Spotify: ["@spotify.com"],
  Klarna: ["@klarna.com"],
  Trustpilot: ["@trustpilot.com"],
  Zettle: ["izettle", "@zettle.com", "@izettle.com"],
  "Kahoot!": ["kahoot", "@kahoot.com"],
  Personio: ["@personio.de", "@personio.com"],
  TrueLayer: ["@truelayer.com"],
  Zopa: ["@zopa.com"],
  Hopin: ["@hopin.com"],
  "Black Forest Labs": ["blackforestlabs", "@blackforestlabs.ai"],
  "Lastminute.com": ["lastminute"],
};

/**
 * Portfolio names that are also ordinary English words.
 *
 * 95 of the 143 portfolio companies are a single word of eight characters or
 * less, and a fair few of those are common nouns. Matched loosely they fire on
 * unrelated prose — "Stream" hit a bio about streaming, "Filed" would hit
 * "profiled", "Era" hits "general". Word-boundary matching fixes most of it;
 * these are the ones that survive even that and need a human to confirm.
 */
const AMBIGUOUS_ALUMNI_NAMES = new Set([
  "era", "dots", "goals", "stream", "filed", "flower", "bunch", "chord", "riff",
  "sticky", "troop", "zeal", "murphy", "nirvana", "katana", "jasper", "tana",
  "qt", "clove", "copper", "tide", "nested", "axon", "bedrock", "flink", "jow",
  "kota", "mimo", "noda", "sona", "avito", "iconic",
]);

/** True when a portfolio name is too generic to match on without confirmation. */
export function isAmbiguousAlumniName(name: string): boolean {
  return AMBIGUOUS_ALUMNI_NAMES.has(name.toLowerCase().replace(/[!.]/g, ""));
}

export const FUND_ALUMNI: { name: string; aliases: string[] }[] = FUND_PORTFOLIO.map((c) => {
  const base = c.name.toLowerCase().replace(/[!.]/g, "");
  return {
    name: c.name,
    aliases: Array.from(new Set([base, ...(EXTRA_ALIASES[c.name] ?? [])])),
  };
}).filter((a) => a.aliases[0].length >= 4); // 3-char names produce too many false hits

// --- Scoring thesis -----------------------------------------------------------
//
// Calibrated to Northzone's 2026 posture, not a generic "AI durability" frame.
// The generic version had a specific, measurable failure: `regulated_trust`
// rewarded any high-stakes buyer, so drug-discovery biotechs scored a mean 8.6
// on it against 7.9 for everything else, and 28 of them landed at fit 7+ despite
// being explicit thesis misfits. Dimensions now encode what the fund actually
// buys, and misfits are flagged rather than merely scored low.
//
// Sources for this calibration are the fund's own recent activity and writing:
// the 2026 AI investments (Black Forest Labs, Blitzy, CuspAI, XBOW, Tandem
// Health, GC AI), the June 2026 partner hire for applied and physical AI at seed
// to Series B across financial services, healthcare and industrial
// manufacturing, a dedicated physical-AI partner covering robotics, autonomous
// systems and industrial automation, and the GC AI investment memo's stated bar.

/** Sectors and shapes the fund is actively buying. */
export const FOCUS_AREAS = [
  "applied AI in financial services",
  "applied AI in healthcare WORKFLOW (clinical documentation, care operations, back office)",
  "applied AI in industrial manufacturing and supply chain",
  "physical AI: robotics, autonomous systems, industrial automation",
  "AI for science and materials discovery",
  "autonomous AI for defence and offensive/defensive security",
  "AI that autonomously performs expert work (software generation, legal, engineering)",
  "frontier models with a defensible application layer",
] as const;

/**
 * Shapes the fund has explicitly said it does not want. These are flagged as
 * misfits regardless of score — a company can be genuinely excellent and still
 * be un-investable for this fund, and conflating the two is what produced a
 * top-of-deck full of drug-discovery companies.
 */
export const ANTI_PATTERNS = [
  {
    key: "drug_discovery",
    label: "Drug discovery / early-stage biotech",
    note: "Therapeutics, drug discovery and preclinical biotech are out of scope. Clinical WORKFLOW software is not — a clinical scribe is in scope, a molecule pipeline is not.",
  },
  {
    key: "ai_productivity_tool",
    label: "Generic AI productivity tool",
    note: "The fund has evaluated hundreds and believes the vast majority are destined for the graveyard. Note-takers, summarisers, generic copilots and chat wrappers score low and are flagged.",
  },
  { key: "pure_hardware", label: "Pure hardware play", note: "Hardware without a software/data compounding layer is out of scope." },
  { key: "pure_consumer", label: "Purely consumer", note: "Consumer-centric businesses with no enterprise or expert-work wedge are out of scope." },
] as const;

export type AntiPatternKey = (typeof ANTI_PATTERNS)[number]["key"];

export const THESIS_DIMENSIONS = [
  {
    key: "workflow_entrenchment",
    label: "Workflow entrenchment",
    question:
      "Does it fundamentally change a workflow in a way that creates an enduring system — used daily, not occasionally?",
    prompt:
      "fundamentally changes a workflow in a way that creates an enduring system, used daily rather than occasionally. Daily habitual use in the core of someone's job scores high; an occasional assistant scores low",
  },
  {
    key: "hard_dollar_roi",
    label: "Hard-dollar ROI",
    question:
      "Is there hard-dollar ROI a buyer can point at, evidenced by retention and usage rather than by the AI itself?",
    prompt:
      "delivers hard-dollar ROI the buyer can point at — replacing spend, headcount or loss — with retention and usage as the proof. The novelty of the AI is NOT evidence; a product that is impressive but whose value is unmeasured scores low",
  },
  {
    key: "proprietary_data",
    label: "Compounding data",
    question:
      "Does it accumulate proprietary data that compounds with use and competitors cannot replicate?",
    prompt: "accumulates proprietary data that compounds with use and competitors cannot replicate",
  },
  {
    key: "thesis_area_fit",
    label: "Thesis area fit",
    question:
      "Is it in an area the fund is actively buying — applied AI in financial services, healthcare workflow or industrial manufacturing; physical AI and robotics; AI for science; autonomous security and defence; or AI performing expert work?",
    prompt:
      `sits in an area the fund is actively buying: ${FOCUS_AREAS.join("; ")}. Score low for anything outside these, however good the company`,
  },
  {
    key: "category_leadership",
    label: "Category leadership",
    question:
      "Could this become the category-defining company in Europe and export globally — the Spotify / Klarna / Trustpilot pattern?",
    prompt:
      "can plausibly become the category-defining company in its space in Europe and export globally (the Spotify/Klarna/Trustpilot pattern), rather than staying a strong local point solution",
  },
] as const;

export type ThesisKey = (typeof THESIS_DIMENSIONS)[number]["key"];
export const THESIS_KEYS = THESIS_DIMENSIONS.map((d) => d.key) as readonly ThesisKey[];

/** The thesis block shared by every scoring system prompt. */
export const THESIS_PROMPT_BLOCK = THESIS_DIMENSIONS.map(
  (d) => `- ${d.key}: ${d.prompt}`,
).join("\n");

/** The anti-pattern block, shared by every scoring system prompt. */
export const ANTI_PATTERN_BLOCK = ANTI_PATTERNS.map(
  (a) => `- ${a.key} (${a.label}): ${a.note}`,
).join("\n");

/** Alumni names as a prompt fragment (truncated set — see FUND_PROMPT_ALUMNI). */
export const ALUMNI_PROMPT_BLOCK = FUND_PROMPT_ALUMNI.join(", ");
