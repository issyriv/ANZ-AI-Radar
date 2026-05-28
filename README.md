# ANZ AI Radar

A personal sourcing tool I built to track what's happening in the ANZ AI ecosystem week to week. It pulls company mentions from around eighteen sources, deduplicates them, and scores each one against four moat dimensions that shape AI durability. It also has a separate GitHub talent radar that flags individual builders who might be about to leave their job and start an AI company.

## The problem

Tracking ANZ AI properly means stitching together a lot of different sources. Startup newsletters, accelerator cohorts, VC portfolio pages, university tech transfer offices, GitHub builder signal. Even then most of the non-obvious picks circulate slowly. I wanted one place where the breadth was already done and where scoring was tied to a thesis I actually cared about, instead of generic "AI startups in Australia" lists.

## The four moats

I score every company on four dimensions that protect against foundation model commodification.

**Switching cost** is whether the product is embedded in a workflow that is genuinely painful to rip out. **Compounding data** is whether the company accumulates proprietary data that gets more valuable with use, in a way competitors cannot replicate. **Regulated trust** is whether the product sells into high-stakes or regulated buyers (legal, health, finance, government) where credibility takes years to build. **Durable distribution** is whether the company's distribution holds up even when the next foundation model release closes the capability gap.

The thinking is in `lib/thesis.ts`. The system prompts that do the actual scoring are in `scripts/deals.ts` and `scripts/enrich.ts`.

## The two products

**The deal flow tracker** (the home page) pulls company mentions from RSS feeds, VC and accelerator portfolio pages, Startmate, YC, and a few publication archives. Around eighteen sources in total. Each company is extracted by Claude Haiku and scored against the four moats. I can filter by sector, stage, source type, fit score, and recency.

**The GitHub talent radar** (the candidates page) searches GitHub for builders in ANZ locations who look like they could found an AI company. The enrichment prompt cares about recent activity on frontier AI repos, AI starring in the last thirty days, founder language in bios, and ex-employees of ANZ scaleups like Canva, Atlassian, Harrison.ai, Heidi, Lorikeet, Relevance AI, and Halter. The idea is to catch senior engineers in the months before they show up in funded deal flow.

There is also a snapshot system that lets me diff the candidate list week over week to find the people whose activity is accelerating, which is the highest signal view for finding stealth founders.

## How it works

Ingestion runs as a set of scripts. `npm run deals` pulls deal flow and portfolio pages, `npm run ingest` pulls GitHub candidates, `npm run enrich` scores them with Claude. The data lives in Supabase. The web app reads from Supabase server-side and renders with Next.js.

Bulk enrichment uses Claude Haiku 4.5 because the volume is high and the per-record reasoning is shallow. The reasoning-heavier extraction passes use Sonnet 4.6. System prompts are cached, which makes recurring ingestion runs noticeably cheaper.

## What this is not

This is a personal tool, not production software. The engineering is intentionally simple. There are no tests, no formal evals on the scoring, and several portfolio pages that render with JavaScript (Antler, Main Sequence, Icehouse) are excluded because plain HTML fetch cannot see their content. The fuzzy location normalisation accepts false positives by design.

If I rebuilt it for a team I would add a headless browser layer for the JS-rendered portfolios, a proper scoring eval set with comparison runs across prompt versions, multi-user notes and shared annotations on companies, alerting on movers in the snapshot diff, and integrations with whatever CRM the team uses. The current version is the v1 that solved my own problem.

## Stack

Next.js 16, TypeScript, Supabase, Anthropic SDK.
