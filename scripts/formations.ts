import "./_bootstrap";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import {
  advancedSearch,
  getCompany,
  getFilingHistory,
  getOfficerAppointments,
  getOfficers,
  hasKey,
  hasShareAllotment,
  normalizeOfficerName,
  searchOfficers,
  type ChCompany,
} from "../lib/companies-house";
import {
  AI_SIC_CODES,
  sicLooksTech,
  hubCity,
  monthsSince,
  nameLooksAI,
  preScore,
  type Formation,
} from "../lib/formations";
import { normalizeName } from "../lib/extract";
import { backend, loadCandidates, loadCompanies } from "../lib/store";
import type { Candidate } from "../lib/types";

// Companies House pre-announcement scan.
//
// Two pathways, run in this order because they have very different cost and
// precision:
//
//   A. person-anchored — for each AI builder already on the talent radar, ask
//      the officer index whether they have quietly become a director of
//      something recently incorporated. One API call per person, very high
//      precision, and it finds companies whose name gives nothing away.
//
//   B. name sweep — recent incorporations under software/deep-tech SIC codes
//      whose company name signals AI. Broad, lower precision, and structurally
//      blind to companies like Wayve that never put "AI" in the name.
//
// Everything here is free: no model calls. Scoring the shortlist is a separate
// step (scripts/formations-score.ts) so the expensive part only ever sees rows
// that already earned their place.

const MAX_MONTHS = Number(process.env.CH_MAX_MONTHS ?? 24);
const MIN_CANDIDATE_FIT = Number(process.env.CH_MIN_FIT ?? 6);
const MAX_CANDIDATES = Number(process.env.CH_MAX_CANDIDATES ?? 400);
const SWEEP_MONTHS = Number(process.env.CH_SWEEP_MONTHS ?? 6);   // how many recent months to sweep
const SWEEP_PAGES = Number(process.env.CH_SWEEP_PAGES ?? 12);    // pages per month window
const SWEEP_SIZE = 100;
const OUT = process.env.CH_OUT ?? ".data/formations.json";
const SKIP_SWEEP = process.env.CH_SKIP_SWEEP === "1";

const RUN_ID = randomUUID();

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Names too common to match on — they return dozens of unrelated officers. */
function tooCommon(name: string): boolean {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) return true;          // single token cannot identify anyone
  if (name.length < 7) return true;
  return false;
}

async function buildFormation(
  company: ChCompany,
  matchedCandidate: string | null,
  extraSignals: string[],
): Promise<Formation | null> {
  const months = monthsSince(company.date_of_creation);
  if (months > MAX_MONTHS) return null;
  if (company.company_status !== "active") return null;

  const filings = await getFilingHistory(company.company_number);
  const officers = await getOfficers(company.company_number);
  const active = officers.filter((o) => !o.resigned_on && o.officer_role === "director");

  // Prior directorships of the first director = serial-founder signal.
  const prior: string[] = [];
  const firstWithLink = active.find((o) => o.links?.officer?.appointments);
  if (firstWithLink?.links?.officer?.appointments) {
    const apps = await getOfficerAppointments(firstWithLink.links.officer.appointments);
    for (const a of apps) {
      const n = a.appointed_to?.company_name;
      if (n && n.toLowerCase() !== company.company_name.toLowerCase()) prior.push(n);
    }
  }

  const postcode = company.registered_office_address?.postal_code ?? null;
  const city = hubCity(company.registered_office_address?.locality, postcode ?? undefined);

  const signals = [...extraSignals];
  if (nameLooksAI(company.company_name)) signals.push("company name signals AI");
  if (hasShareAllotment(filings)) signals.push("SH01 share allotment filed (raised quietly)");
  if (months <= 12) signals.push(`incorporated ${months.toFixed(0)} months ago`);
  if (prior.length) signals.push(`director has ${prior.length} prior directorship(s)`);
  if (city) signals.push(`registered in ${city}`);

  const base = {
    company_number: company.company_number,
    company_name: company.company_name,
    incorporated_on: company.date_of_creation,
    months_old: Math.round(months * 10) / 10,
    sic_codes: company.sic_codes ?? [],
    hq_city: city,
    postcode,
    officers: active.map((o) => normalizeOfficerName(o.name)),
    signals,
    matched_candidate: matchedCandidate,
    has_share_allotment: hasShareAllotment(filings),
    prior_companies: prior.slice(0, 8),
  };
  return { ...base, score: preScore(base) };
}

// --- pathway A: person-anchored --------------------------------------------

async function personAnchored(
  candidates: Candidate[],
  known: Set<string>,
  found: Map<string, Formation>,
): Promise<void> {
  const usable = candidates
    .filter((c) => (c.fit_score ?? 0) >= MIN_CANDIDATE_FIT)
    .filter((c) => c.name && !tooCommon(c.name.toLowerCase()))
    .slice(0, MAX_CANDIDATES);

  console.log(
    `[ch:person] ${usable.length} talent-radar candidates with a usable name and fit >= ${MIN_CANDIDATE_FIT}`,
  );
  if (usable.length === 0) {
    console.log("[ch:person] nothing to anchor on — run `npm run ingest` and `npm run enrich` first");
    return;
  }

  let checked = 0;
  for (const c of usable) {
    checked++;
    const target = normalizeOfficerName(c.name!);
    let hits;
    try {
      hits = await searchOfficers(c.name!);
    } catch (e) {
      console.error(`[ch:person] ${c.github_login}: ${(e as Error).message}`);
      continue;
    }
    // Require an exact normalized-name match; the officer index is fuzzy.
    const exact = hits.filter((h) => normalizeOfficerName(h.title) === target);
    for (const h of exact.slice(0, 3)) {
      if (!h.links?.self) continue;
      const apps = await getOfficerAppointments(h.links.self);
      for (const a of apps) {
        const num = a.appointed_to?.company_number;
        if (!num || a.resigned_on) continue;
        if (a.appointed_on && monthsSince(a.appointed_on) > MAX_MONTHS) continue;
        if (found.has(num)) continue;
        const company = await getCompany(num);
        if (!company) continue;
        // The whole point is companies NOT already in the funded map.
        if (known.has(normalizeName(company.company_name))) continue;
        // Being technical does not make every company a person starts technical.
        if (!sicLooksTech(company.sic_codes ?? [])) {
          console.log(`[ch:person] skip ${company.company_name} — SIC ${(company.sic_codes ?? []).join(",") || "none"} is not tech`);
          continue;
        }
        const f = await buildFormation(company, c.github_login, [
          `${c.name} (github.com/${c.github_login}${c.fit_score != null ? `, talent-radar fit ${c.fit_score}` : ", not yet enriched"}) is an active director`,
        ]);
        if (f) {
          found.set(num, f);
          console.log(
            `[ch:person] ${f.company_name} — ${c.github_login}, ${f.months_old}mo old, score ${f.score}`,
          );
        }
      }
    }
    if (checked % 25 === 0) console.log(`[ch:person] ${checked}/${usable.length} people checked, ${found.size} formations`);
  }
}

// --- pathway B: name sweep --------------------------------------------------

async function nameSweep(known: Set<string>, found: Map<string, Formation>): Promise<void> {
  // Walk one month at a time, newest first.
  //
  // The advanced-search endpoint does not return results newest-first, so
  // paging a single wide date range samples an arbitrary — in practice, the
  // oldest — slice of it. A calibration run over a 24-month window returned
  // nothing under 18 months old, which is precisely the wrong end: a two-year-old
  // company nobody has heard of is usually a dead shell, while the interesting
  // window is the first few months before anyone announces. Month-sized windows
  // make coverage explicit and start where the signal is.
  let shortlisted = 0;
  let scanned = 0;

  for (let m = 0; m < SWEEP_MONTHS; m++) {
    const to = isoMonthsAgo(m);
    const from = isoMonthsAgo(m + 1);
    let monthHits = 0;

    for (let page = 0; page < SWEEP_PAGES; page++) {
      const { items, hits } = await advancedSearch({
        sicCodes: AI_SIC_CODES,
        incorporatedFrom: from,
        incorporatedTo: to,
        size: SWEEP_SIZE,
        startIndex: page * SWEEP_SIZE,
      });
      if (page === 0) {
        monthHits = hits;
        console.log(`[ch:sweep] ${from} to ${to}: ${hits.toLocaleString()} incorporations, sweeping up to ${SWEEP_PAGES * SWEEP_SIZE}`);
      }
      if (items.length === 0) break;
      scanned += items.length;

      // Deterministic filter BEFORE any per-company API call.
      const interesting = items.filter(
        (c) => nameLooksAI(c.company_name) && !known.has(normalizeName(c.company_name)),
      );
      shortlisted += interesting.length;
      for (const c of interesting) {
        if (found.has(c.company_number)) continue;
        const f = await buildFormation(c, null, ["surfaced by SIC + name sweep"]);
        if (f) {
          found.set(c.company_number, f);
          if (f.score >= 4) {
            console.log(`[ch:sweep] ${f.company_name} — ${f.months_old}mo, ${f.officers.length} dir, score ${f.score}`);
          }
        }
      }
      if (items.length < SWEEP_SIZE) break;
    }
    const covered = Math.min(SWEEP_PAGES * SWEEP_SIZE, monthHits);
    if (monthHits > covered) {
      console.log(`[ch:sweep]   covered ${covered.toLocaleString()} of ${monthHits.toLocaleString()} (${Math.round(100 * covered / monthHits)}%) — raise CH_SWEEP_PAGES for full coverage`);
    }
  }
  console.log(`[ch:sweep] ${shortlisted} shortlisted from ${scanned.toLocaleString()} scanned`);
}

// --- main -------------------------------------------------------------------

async function main() {
  if (!hasKey()) {
    console.error(
      "COMPANIES_HOUSE_API_KEY not set in .env.local.\n" +
        "Get a free key: https://developer.company-information.service.gov.uk/ " +
        "-> Your Applications -> create application -> REST API key",
    );
    process.exit(1);
  }
  console.log(`[ch] run ${RUN_ID} · store=${await backend()}`);

  // Everything already in the funded map is by definition not a hidden gem.
  const companies = await loadCompanies();
  const known = new Set(companies.map((c) => c.name_normalized).filter(Boolean));
  const candidates = await loadCandidates();
  console.log(`[ch] excluding ${known.size} already-known companies · ${candidates.length} talent-radar candidates`);

  const found = new Map<string, Formation>();
  await personAnchored(candidates, known, found);
  if (!SKIP_SWEEP) await nameSweep(known, found);

  const all = [...found.values()].sort((a, b) => b.score - a.score);
  writeFileSync(OUT, JSON.stringify({ run_id: RUN_ID, generated_at: new Date().toISOString(), count: all.length, formations: all }, null, 2));

  const anchored = all.filter((f) => f.matched_candidate).length;
  const raised = all.filter((f) => f.has_share_allotment).length;
  console.log(`\n[ch] ${all.length} formations -> ${OUT}`);
  console.log(`[ch]   ${anchored} person-anchored · ${raised} with a share allotment`);
  console.log(`[ch]   top 10:`);
  for (const f of all.slice(0, 10)) {
    console.log(`[ch]     ${String(f.score).padStart(4)}  ${f.company_name} (${f.months_old}mo, ${f.hq_city ?? "?"}) — ${f.signals[0]}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
