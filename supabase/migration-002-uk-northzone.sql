-- Migration 002 — ANZ/Airtree  ->  UK/Northzone
--
-- Run this in the Supabase SQL Editor. Idempotent; safe to re-run.
--
-- Three changes:
--   1. Rename the fund-specific overlap columns (airtree_* -> fund_*).
--   2. Add companies.hq_city for the UK city filter.
--   3. Add the source_runs table that backs the /sources health view.
--
-- The thesis_breakdown JSONB gains a fifth `category_leadership` dimension.
-- That needs no DDL — rows scored before this migration simply lack the key,
-- and the UI renders a missing dimension as "not scored".

-- 1. Fund overlap column renames ------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'companies'
               and column_name = 'airtree_overlap') then
    alter table public.companies rename column airtree_overlap to fund_overlap;
  end if;
end $$;

alter table public.companies
  add column if not exists fund_overlap text[] default '{}';

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'candidates'
               and column_name = 'airtree_alumni_match') then
    alter table public.candidates rename column airtree_alumni_match to fund_alumni_match;
  end if;
end $$;

alter table public.candidates
  add column if not exists fund_alumni_match text[] default '{}';

-- 2. UK city on companies -------------------------------------------------------
alter table public.companies
  add column if not exists hq_city text;

create index if not exists companies_hq_city_idx on public.companies (hq_city);

-- 3. Source health --------------------------------------------------------------
-- One row per source per pipeline run. This is what makes the crawl auditable:
-- which of the ~70 sources still parse, which needed the headless browser, and
-- how many companies each actually contributed.
create table if not exists public.source_runs (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null,                 -- groups one whole pipeline run
  source            text not null,
  source_type       text,
  url               text,
  mode              text,                          -- requested: auto | http | headless
  via               text,                          -- actual:    http | headless | cache
  http_status       integer,
  ok                boolean not null default false,
  items_found       integer not null default 0,    -- raw candidates seen on the page
  companies_stored  integer not null default 0,    -- rows upserted after scoring
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists source_runs_run_idx     on public.source_runs (run_id);
create index if not exists source_runs_created_idx on public.source_runs (created_at desc);
create index if not exists source_runs_source_idx  on public.source_runs (source);

-- Reload the PostgREST schema cache so the app sees the changes immediately.
notify pgrst, 'reload schema';
