# London AI Radar

A sourcing tool for UK AI deal flow, pointed at [Northzone](https://northzone.com). It crawls around seventy sources, deduplicates the companies it finds, and scores each one against five dimensions of AI durability. It also runs a separate GitHub talent radar that flags individual builders in London and the other UK hubs who might be about to leave their job and start an AI company.

## The problem

Tracking UK AI properly means stitching together a lot of different sources. Startup newsletters, accelerator cohorts, VC portfolio pages, university tech transfer offices, GitHub builder signal. Most of it is not in one place, and a good chunk of it is behind JavaScript that a plain HTTP fetch cannot see. I wanted one place where the breadth was already done and where the scoring was tied to a specific fund's thesis rather than a generic "AI startups in the UK" list.

## The five dimensions

Every company is scored 1-10 on five dimensions that protect AI-native revenue against foundation model commodification.

**Switching cost** is whether the product is embedded in a workflow that is genuinely painful to rip out. **Compounding data** is whether the company accumulates proprietary data that gets more valuable with use, in a way competitors cannot replicate. **Regulated trust** is whether the product sells into high-stakes or regulated buyers (legal, health, finance, government) where credibility takes years to build. **Durable distribution** is whether the company's distribution holds up even when the next foundation model release closes the capability gap.

The fifth is Northzone-specific. **Category leadership** asks whether this could become the category-defining company in Europe and then export globally — the Spotify, Klarna, Trustpilot pattern Northzone has backed repeatedly since 1996. It is the dimension that separates a strong local point solution from the kind of outcome that fund actually needs.

The thesis and the fund profile live in `lib/fund.ts`. The system prompts that do the scoring are in `lib/extract.ts`.

## The fund profile is scraped, not hardcoded

`npm run fund:sync` renders Northzone's own portfolio page and writes `lib/fund-portfolio.json` — currently 143 companies with status, stage, industry and country. That file is the alumni list used for overlap detection, so when a founder is ex-Klarna or a round is co-led by a Northzone company, the radar flags it. Hardcoding 143 names would rot; this keeps it one command.

## The pre-announcement layer (Companies House)

Every other source here lists companies that already have an investor or press coverage, which by definition excludes anything undiscovered. The UK register does not: a company must file its incorporation within weeks of forming, long before it announces anything.

`npm run formations` runs two pathways, neither of which costs a model call:

**Person-anchored.** For each builder already on the talent radar, ask the officer index whether they have quietly become a director of something incorporated recently that is not already in the funded map. One API call per person, and it finds companies whose name gives nothing away.

**Name sweep.** Recent incorporations under nine software and deep-tech SIC codes whose company name signals AI, walked one month at a time from today backwards. The month windows matter: the advanced-search endpoint does not return newest-first, so paging a wide date range silently samples the oldest end of it.

Both feed a deterministic pre-score (a radar director is +5, an SH01 share allotment +3, under six months old +3, two or more directors +2, a lone director -2) so `npm run formations:score` only ever pays to triage a shortlist.

That triage is deliberately **not** a durability score. A company incorporated three months ago has no public product, customers or revenue, so scoring it on switching cost would mean inventing facts. It answers what the register actually supports: is this a real venture or a contractor shell, what does it plausibly do, and is it worth a call.

### What the first real scan found

Worth writing down, because it is the honest answer to "can this find hidden gems".

The name sweep scanned 12,000 incorporations across three months, shortlisted 605, and built 585 formation records. Triaging the top 120 returned **zero marked "reach out"** — 104 watch, 16 ignore, venture likelihood peaking at 6/10 and averaging 4.5, with mean confidence 3.7.

That is not a bug, it is the mechanism. Anyone can incorporate "SOMETHING AI LTD" for fifty pounds, so filtering on the name selects for people who want to look like an AI company, which is close to anti-correlated with being a serious one. In an earlier calibration run, 76% of name-sweep hits had a single director, which is the shape of a personal service company rather than a venture.

The pathway that would work is the person-anchored one, and it was blocked during this scan: it needs the GitHub talent radar populated, and the token had expired. A company name reveals nothing about the good ones — Wayve does not contain "AI" and never would have surfaced. Provenance has to come from the person, not the name.

## The three views

**Deal flow** (the home page) pulls company mentions from RSS feeds, VC and accelerator portfolio pages, university spinout vehicles, and the Y Combinator directory filtered to the UK. Each company is extracted and scored, and can be filtered by sector, stage, source type, fit score and recency.

**Talent radar** (the candidates page) searches GitHub for builders in London, Cambridge, Oxford, Manchester, Bristol, Edinburgh and the other UK hubs who look like they could found an AI company. The enrichment prompt cares about recent activity on frontier AI repos, AI starring in the last thirty days, founder language in bios, and ex-employees of the Northzone portfolio. The idea is to catch senior engineers in the months before they show up in funded deal flow. A snapshot system diffs the list week over week to find the people whose activity is accelerating.

**Formations** (the formations page) is the Companies House output described above, presented separately from the deal flow because it is a different kind of object and must be read differently.

**Source health** (the sources page) is the audit trail. Sources rot silently — a site redesign turns a working scraper into one that returns zero rows without ever erroring. This page shows every source from the most recent crawl, how it was fetched, how long it took, and how many companies it actually contributed.

## The headless browser layer

A meaningful share of UK VC portfolio pages are client-rendered, client-routed, or behind a bot check. Plain HTTP gets an empty shell, a 404 that is really a client route, or a 429. `lib/browser.ts` renders those in headless Chromium: one shared browser process, images and fonts blocked so pages load fast, auto-scrolling to trigger lazy-loaded grids, and a hard wall-clock deadline so an infinite-scroll page cannot stall the crawl (one took eight minutes before that deadline existed).

`lib/fetcher.ts` decides which path to take. Sources marked `auto` try HTTP first and fall back to the browser only when the page comes back thin, which means a source that switches to client rendering keeps working without a code change. Sources marked `headless` skip the wasted round trip. Everything is disk-cached, so re-running the crawl while iterating on prompts costs nothing in fetches.

`npm run probe` re-triages every candidate source and prints what a static scrape would actually see, which is how entries get moved between the two modes after a redesign.

## Cost control

The crawl makes hundreds of model calls. `lib/cost.ts` meters every one against live per-token rates and enforces a hard budget: `LLM_BUDGET_USD=3 npm run deals` aborts cleanly the moment the budget is hit rather than discovering the spend afterwards. Bulk list and grid scoring runs on Claude Haiku 4.5 because the per-record reasoning is shallow; prose extraction from news articles runs on Sonnet 4.6. System prompts are cached. Portfolio grids overlap heavily between funds, so by default a company that has already been scored is skipped rather than re-scored.

## Storage

Supabase is the intended backend. It is not required: the store probes it once at startup and falls back to a local JSON store under `.data/` when it cannot be reached, so the pipeline and the UI both run end to end with no cloud dependency. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to a live project to use Supabase, and apply `supabase/schema.sql` followed by `supabase/migration-002-uk-northzone.sql`.

## Running it

```bash
npm run fund:sync         # refresh the Northzone portfolio / alumni list
npm run deals             # crawl sources, extract and score companies
npm run ingest            # pull GitHub candidates
npm run enrich            # score candidates with Claude
npm run formations        # Companies House pre-announcement scan (free)
npm run formations:score  # triage the shortlist
npm run verify:geo        # re-check HQ country on stored companies
npm run probe             # re-triage sources into http vs headless
npm run dev               # the UI
```

Needs `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and a **live** `COMPANIES_HOUSE_API_KEY` — Companies House sets live-versus-sandbox at the *application* level, so a key created under a test application will only ever authenticate against the empty sandbox.

Useful switches: `DEALS_ONLY=news|portfolios|yc` runs one stage, `DEALS_SOURCE=Atomico` runs one source, `LLM_BUDGET_USD` sets the hard spend cap, `CRAWL_CACHE=0` bypasses the page cache, and `STORE_BACKEND=local|supabase` forces a backend.

## What this is not

This is a personal tool, not production software. The engineering is deliberately simple and there are no tests. There are no formal evals on the scoring, which is the biggest real gap: the five dimensions are scored by a model with no comparison set to check drift between prompt versions.

Two failure modes found by running it are worth knowing about, because both were silent. Asking the model to "only include UK companies" made it relabel rather than omit — Figma, Notion and Personio all came back tagged as London — so the prompt now asks for the true country and the filtering happens in code. And a tool call that hits `max_tokens` returns truncated JSON with no error, which once caused a full crawl to store zero rows; `lib/extract.ts` now checks `stop_reason` and says so. The location normalisation is fuzzy and accepts false positives by design, though it now explicitly rejects the ambiguous non-UK cases (Cambridge MA, Birmingham AL) that would otherwise pollute the UK buckets.

If I rebuilt it for a team I would add a scoring eval set with comparison runs across prompt versions, alerting on movers in the snapshot diff, multi-user notes and shared annotations, entity resolution on company websites rather than just normalised names, and integrations with whatever CRM the team uses.

## Stack

Next.js 16, TypeScript, Playwright, Supabase, Anthropic SDK.
