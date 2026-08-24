-- London AI Radar — Supabase schema (Northzone)
-- Run this in the Supabase SQL Editor (idempotent; safe to re-run).
-- Access pattern: all reads/writes happen server-side with the SECRET (service_role)
-- key, which bypasses RLS. We keep RLS on (default) and add no public policies,
-- so the scraped candidate data is never exposed via the public/anon API.

-- ---------------------------------------------------------------------------
-- candidates: one row per GitHub user we surface
-- ---------------------------------------------------------------------------
create table if not exists public.candidates (
  id                      uuid primary key default gen_random_uuid(),

  -- GitHub identity
  github_login            text not null unique,
  github_id              bigint unique,
  name                    text,
  bio                     text,
  company                 text,
  email                   text,
  blog                    text,                 -- personal site / portfolio
  twitter_username        text,
  avatar_url              text,
  html_url                text,                 -- github.com/<login>
  hireable                boolean,

  -- raw location + our normalized guess (fuzzy; false positives accepted)
  location                text,
  location_normalized     text,                 -- e.g. "London"

  -- GitHub stats
  followers               integer default 0,
  following               integer default 0,
  public_repos            integer default 0,
  account_created_at      timestamptz,          -- when the GH account was created
  github_updated_at       timestamptz,          -- profile last updated

  -- AI-signal source data (filled by ingest)
  top_repos               jsonb default '[]'::jsonb,   -- [{name,description,stars,language,fork,pushed_at,html_url}]
  starred_ai_sample       jsonb default '[]'::jsonb,   -- sample of AI repos they starred
  starred_ai_count        integer default 0,           -- total AI repos starred
  starred_ai_30d          integer default 0,           -- AI repos starred in last 30 days
  contributed_ai_repos    jsonb default '[]'::jsonb,   -- seed AI repos they pushed to / interacted with
  matched_signals         text[] default '{}',         -- which seed repos / terms matched (raw)
  last_ai_activity_at     timestamptz,                 -- most recent AI-relevant activity

  -- LLM enrichment (filled by enrich)
  enrichment_summary      text,                 -- 2-line "why interesting"
  fit_score               integer,              -- 1-10 "could found / about to found an AI company"
  signals                 text[] default '{}',  -- flagged signals (human-readable)
  fund_alumni_match       text[] default '{}',  -- matched Northzone portfolio companies
  enrichment_model        text,
  enriched_at             timestamptz,
  enrichment_raw          jsonb,                -- full model response for debugging

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists candidates_fit_score_idx        on public.candidates (fit_score desc nulls last);
create index if not exists candidates_last_ai_activity_idx  on public.candidates (last_ai_activity_at desc nulls last);
create index if not exists candidates_location_norm_idx     on public.candidates (location_normalized);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
  before update on public.candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- snapshots: point-in-time captures so we can diff week-over-week
-- ("who became more active in the last 7 days" = highest-signal VC view)
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  id               uuid primary key default gen_random_uuid(),
  label            text,                          -- optional human label
  candidate_count  integer default 0,
  -- frozen per-candidate metrics: [{login, fit_score, last_ai_activity_at,
  --   starred_ai_count, starred_ai_30d, followers, public_repos}]
  data             jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists snapshots_created_at_idx on public.snapshots (created_at desc);

-- ---------------------------------------------------------------------------
-- cut_through_posts: Cut Through Venture Substack extraction (stretch goal)
-- ---------------------------------------------------------------------------
create table if not exists public.cut_through_posts (
  id            uuid primary key default gen_random_uuid(),
  post_url      text unique,
  title         text,
  published_at  timestamptz,
  -- [{company, stage, sector, founders:[...], ai_native:bool}]
  extracted     jsonb default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- companies: UK startups pulled from the crawl, scored vs the Northzone thesis.
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  name_normalized     text not null unique,        -- dedupe key (lowercased, stripped)
  website             text,
  description         text,

  -- extracted deal facts
  stage               text,                         -- pre-seed / seed / series a / grant / unknown
  sector              text,
  hq_city             text,                          -- normalized UK city
  ai_native           boolean default false,
  amount_raised       text,                         -- raw string e.g. "$3.5M"
  investors           text[] default '{}',
  founders            text[] default '{}',

  -- provenance
  source              text,                         -- "UKTN", "Seedcamp", "Atomico", etc.
  source_type         text,                         -- accelerator | vc_portfolio | publication | university | job_signal
  source_url          text,
  source_published_at timestamptz,

  -- thesis scoring (filled by score pass)
  thesis_fit_score    integer,                      -- 1-10 vs Northzone durability thesis
  thesis_breakdown    jsonb,                        -- {switching_cost, proprietary_data, regulated_trust, distribution: {score, note}}
  fund_overlap        text[] default '{}',          -- founders/investors overlapping the Northzone portfolio
  summary             text,                         -- why it fits / why interesting
  scoring_model       text,
  scored_at           timestamptz,
  raw_extract         jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists companies_thesis_fit_idx  on public.companies (thesis_fit_score desc nulls last);
create index if not exists companies_published_idx   on public.companies (source_published_at desc nulls last);
create index if not exists companies_sector_idx      on public.companies (sector);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- Force PostgREST (the Data API) to reload its schema cache so the tables above
-- are immediately visible to the app and scripts.
notify pgrst, 'reload schema';
