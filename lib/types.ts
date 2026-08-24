import type { ThesisKey } from "./fund";

// Shared types mirroring the Supabase schema (supabase/schema.sql).

export interface RepoSummary {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  fork: boolean;
  pushed_at: string | null;
  html_url: string;
}

export interface StarredRepoSummary {
  full_name: string;
  description: string | null;
  starred_at: string | null;
  html_url: string;
}

export interface Candidate {
  id: string;

  github_login: string;
  github_id: number | null;
  name: string | null;
  bio: string | null;
  company: string | null;
  email: string | null;
  blog: string | null;
  twitter_username: string | null;
  avatar_url: string | null;
  html_url: string | null;
  hireable: boolean | null;

  location: string | null;
  location_normalized: string | null;

  followers: number;
  following: number;
  public_repos: number;
  account_created_at: string | null;
  github_updated_at: string | null;

  top_repos: RepoSummary[];
  starred_ai_sample: StarredRepoSummary[];
  starred_ai_count: number;
  starred_ai_30d: number;
  contributed_ai_repos: string[];
  matched_signals: string[];
  last_ai_activity_at: string | null;

  enrichment_summary: string | null;
  fit_score: number | null;
  signals: string[];
  fund_alumni_match: string[];
  enrichment_model: string | null;
  enriched_at: string | null;
  enrichment_raw: unknown | null;

  created_at: string;
  updated_at: string;
}

// What the enrichment model returns (parsed from JSON).
export interface EnrichmentResult {
  summary: string;
  fit_score: number;
  signals: string[];
  fund_alumni_match: string[];
}

export interface SnapshotRow {
  login: string;
  fit_score: number | null;
  last_ai_activity_at: string | null;
  starred_ai_count: number;
  starred_ai_30d: number;
  followers: number;
  public_repos: number;
}

export interface Snapshot {
  id: string;
  label: string | null;
  candidate_count: number;
  data: SnapshotRow[];
  created_at: string;
}

export interface CutThroughExtraction {
  company: string;
  stage: string | null;
  sector: string | null;
  founders: string[];
  ai_native: boolean;
}

export interface CutThroughPost {
  id: string;
  post_url: string;
  title: string | null;
  published_at: string | null;
  extracted: CutThroughExtraction[];
  created_at: string;
}

export interface ThesisDimension {
  score: number; // 1-10
  note: string;
}

// Keyed by lib/fund.ts THESIS_DIMENSIONS. `category_leadership` is the
// Northzone-specific fifth dimension; it is absent from rows scored before it
// was introduced, so every consumer must treat dimensions as optional.
export type ThesisBreakdown = Partial<Record<ThesisKey, ThesisDimension>>;

// One company extracted from a deal/news feed and scored vs the Northzone thesis.
export interface Company {
  id: string;
  name: string;
  name_normalized: string;
  website: string | null;
  description: string | null;

  stage: string | null;
  sector: string | null;
  ai_native: boolean;
  amount_raised: string | null;
  investors: string[];
  founders: string[];

  source: string | null;
  source_type: string | null; // accelerator | vc_portfolio | publication | university
  source_url: string | null;
  source_published_at: string | null;

  hq_country: string | null;  // actual HQ country as reported by extraction
  hq_city: string | null;     // actual HQ city

  // Derived from the Companies House register by scripts/funding.ts. Portfolio
  // pages almost never state stage or dates; the register does, for free.
  ch_company_number: string | null;
  incorporated_on: string | null;
  last_raise_on: string | null;        // date of the most recent SH01 allotment
  share_issues_on_register: number | null; // SH01 filings; NOT a round count
  accounts_type: string | null;        // CH last-accounts type, a size proxy
  maturity: string | null;             // early | growing | mature (sourcing relevance)
  maturity_source: string | null;      // "register" | "model"
  stage_source: string | null;         // "reported" (from an article) | "register"
  register_match_confidence: number | null;

  thesis_fit_score: number | null;
  thesis_breakdown: ThesisBreakdown | null;
  fund_overlap: string[];
  thesis_misfit: boolean | null;   // matches a stated anti-pattern; out of scope regardless of score
  misfit_reason: string | null;
  thesis_version: string | null;   // which thesis produced thesis_fit_score
  summary: string | null;
  scoring_model: string | null;
  scored_at: string | null;
  raw_extract: unknown | null;

  created_at: string;
  updated_at: string;
}

// What the extraction model returns per company found in an article.
export interface CompanyExtraction {
  name: string;
  website: string | null;
  description: string | null;
  stage: string | null;
  sector: string | null;
  ai_native: boolean;
  amount_raised: string | null;
  investors: string[];
  founders: string[];
}

// One crawl of one source. Powers the /sources health view: which sources are
// still working, which needed the headless browser, and what each one yielded.
export interface SourceRun {
  id: string;
  run_id: string;            // groups all sources from a single pipeline run
  source: string;
  source_type: string | null;
  url: string | null;
  mode: string | null;       // requested: auto | http | headless
  via: string | null;        // actual: http | headless | cache
  http_status: number | null;
  ok: boolean;
  items_found: number;       // raw candidates seen on the page
  companies_stored: number;  // rows upserted after extraction + scoring
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}
