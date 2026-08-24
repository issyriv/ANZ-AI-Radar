import "./_bootstrap";
import {
  getCompany,
  getFilingHistory,
  hasKey,
  searchCompanies,
} from "../lib/companies-house";
import {
  allotmentDates,
  matchScore,
  maturityFrom,
  stageFromRegister,
  type FundingHistory,
} from "../lib/funding-history";
import { loadCompanies, upsert } from "../lib/store";
import type { Company } from "../lib/types";

// Fill in stage and last-raise date from the Companies House register.
//
// Free: no model calls at all. Roughly 3 API calls per company (name search,
// company record, filing history), self-throttled to stay under the 600-per-5-
// minutes limit.
//
//   npx tsx scripts/funding.ts              # only rows missing a stage
//   FUNDING_FORCE=1 npx tsx scripts/funding.ts   # re-check everything
//   FUNDING_LIMIT=100 npx tsx scripts/funding.ts

const FORCE = process.env.FUNDING_FORCE === "1";
const LIMIT = process.env.FUNDING_LIMIT ? Number(process.env.FUNDING_LIMIT) : undefined;
const MIN_MATCH = Number(process.env.FUNDING_MIN_MATCH ?? 10); // 10 = exact only
const UK = /^(united kingdom|uk|england|scotland|wales|northern ireland|britain)$/i;

function monthsSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / (30 * 86_400_000);
}

async function lookup(name: string): Promise<FundingHistory | null> {
  let hits;
  try {
    hits = await searchCompanies(name);
  } catch (e) {
    console.error(`[funding] search "${name}": ${(e as Error).message}`);
    return null;
  }
  if (!hits.length) return null;

  // Exact normalized-name matches only.
  const exact = hits.filter((h) => matchScore(name, h.title) >= MIN_MATCH);
  if (!exact.length) return null;

  // Refuse ambiguity outright.
  //
  // The register is full of dormant shells and subsidiaries sharing a name, so
  // "one of the exact matches is probably right" is not good enough: it gave
  // Wise an incorporation date of 2021 (the real company is 2010), Deliveroo
  // 2021, and Agon 2011. Attaching another company's funding history to a row
  // is a silent, confident error, and a missing date is far cheaper than a
  // wrong one.
  if (exact.length > 1) {
    console.log(`[funding] ambiguous: "${name}" matches ${exact.length} companies on the register — skipped`);
    return null;
  }

  const best = exact[0];
  const company = await getCompany(best.company_number);
  if (!company) return null;
  const filings = await getFilingHistory(best.company_number);
  const dates = allotmentDates(filings);
  const months = monthsSince(company.date_of_creation ?? null);

  const accountsType = company.accounts?.last_accounts?.type ?? null;

  return {
    company_number: best.company_number,
    accounts_type: accountsType,
    maturity: maturityFrom(accountsType, months),
    incorporated_on: company.date_of_creation ?? null,
    allotment_dates: dates,
    last_raise_on: dates[0] ?? null,
    share_issues_on_register: dates.length,
    stage_inferred: stageFromRegister(dates.length, months),
    match_confidence: 10, // exact normalized match, and ambiguity is refused above
  };
}

async function main() {
  if (!hasKey()) {
    console.error("COMPANIES_HOUSE_API_KEY not set (needs a LIVE key).");
    process.exit(1);
  }
  const all = await loadCompanies();
  let todo = all.filter((c: Company) => {
    if (c.hq_country && !UK.test(String(c.hq_country).trim())) return false; // register is UK-only
    if (FORCE) return true;
    return !c.last_raise_on; // not yet looked up
  });
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log(`[funding] ${todo.length} UK companies to check against the register`);
  let matched = 0;
  let withRaise = 0;
  const updates: Record<string, unknown>[] = [];

  for (const [i, c] of todo.entries()) {
    const fh = await lookup(c.name);
    if (fh) {
      matched++;
      if (fh.last_raise_on) withRaise++;
      updates.push({
        ...c,
        ch_company_number: fh.company_number,
        incorporated_on: fh.incorporated_on,
        accounts_type: fh.accounts_type,
        // The register beats the model. A filed accounts type and an
        // incorporation date are facts; the model's read of a name is a guess,
        // and it wrongly called Agon, Oshen and MatAlytics "mature".
        maturity: fh.maturity,
        maturity_source: "register",
        last_raise_on: fh.last_raise_on,
        share_issues_on_register: fh.share_issues_on_register,
        // Never overwrite a stage a funding article stated explicitly.
        // Only ever fills a gap; a stage stated by a funding article always wins.
        stage: c.stage || fh.stage_inferred,
        stage_source: c.stage ? "reported" : fh.stage_inferred ? "register" : null,
        register_match_confidence: fh.match_confidence,
      });
    }
    if ((i + 1) % 50 === 0) {
      console.log(`[funding] ${i + 1}/${todo.length} · ${matched} matched · ${withRaise} with a dated raise`);
      if (updates.length) {
        await upsert("companies", updates.splice(0), "name_normalized");
      }
    }
  }
  if (updates.length) await upsert("companies", updates, "name_normalized");

  console.log(`\n[funding] DONE — ${matched}/${todo.length} matched on the register (${Math.round(100 * matched / Math.max(1, todo.length))}%)`);
  console.log(`[funding] ${withRaise} have at least one dated share allotment`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
