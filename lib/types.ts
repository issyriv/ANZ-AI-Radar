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
  airtree_alumni_match: string[];
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
  airtree_alumni_match: string[];
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

export interface ThesisBreakdown {
  switching_cost: ThesisDimension;
  proprietary_data: ThesisDimension;
  regulated_trust: ThesisDimension;
  distribution: ThesisDimension;
}

// One company extracted from a deal/news feed and scored vs the Airtree thesis.
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
  source_type: string | null; // accelerator | vc_portfolio | publication | university | job_signal
  source_url: string | null;
  source_published_at: string | null;

  thesis_fit_score: number | null;
  thesis_breakdown: ThesisBreakdown | null;
  airtree_overlap: string[];
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
