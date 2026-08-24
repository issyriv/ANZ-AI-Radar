// Deriving funding history from the Companies House register.
//
// Portfolio pages give a company name and a one-line description. They almost
// never say what round a company is at or when it last raised — measured across
// this dataset, stage was present on 6% of UK companies and a date on 1%.
//
// The register fills that gap for free. A UK limited company must file an SH01
// within a month of allotting shares, and a share allotment IS a funding round.
// So the filing history gives dated, primary-source funding events for almost
// every private UK company, without a paid data provider.
//
// What this can and cannot tell you, stated honestly:
//   CAN  - the exact date shares were last issued
//   CAN  - how many share issues there have been
//   CAN  - how old the company is
//   CANNOT - the amount raised (SH01 states share capital, not cash in, and the
//            document itself is a scanned form behind a separate endpoint)
//   CANNOT - the round LABEL. "Series A" is a market convention, not a filing.
// The round label below is therefore an inference and is always marked as one.

import type { ChFiling } from "./companies-house";

/** Filing types that represent equity being issued. */
const ALLOTMENT_TYPES = new Set(["SH01"]);

export interface FundingHistory {
  company_number: string;
  accounts_type: string | null;
  maturity: Maturity;
  incorporated_on: string | null;
  /** Dates of share allotments, newest first. Each is a share ISSUE, not a round. */
  allotment_dates: string[];
  last_raise_on: string | null;
  /** Count of SH01 filings. NOT a round count — see note below. */
  share_issues_on_register: number;
  /** Only set where the register genuinely supports it. Usually null. */
  stage_inferred: string | null;
  /** How confident the name match was, 1-10. */
  match_confidence: number;
}

export function allotmentDates(filings: ChFiling[]): string[] {
  return filings
    .filter((f) => ALLOTMENT_TYPES.has((f.type ?? "").toUpperCase()))
    .map((f) => f.date ?? "")
    .filter(Boolean)
    .sort()
    .reverse();
}

/**
 * What the register supports about funding stage — which is very little.
 *
 * An earlier version mapped SH01 count to a round label and was confidently
 * wrong: Fractile, a seed-stage AI chip company, has 25 SH01 filings and was
 * labelled "series b+". Share issues are not rounds. SEIS/EIS investors file
 * separately, option exercises file, and a single priced round routinely
 * produces many allotments as investors close at different times.
 *
 * So only one inference survives: a company that has issued NO shares since
 * incorporation has taken no equity investment. That is a fact about the
 * register, and it is exactly the "nobody has invested yet" signal worth having.
 * Everything else is left to the publication feed, which states rounds explicitly.
 */
export function stageFromRegister(shareIssues: number, monthsOld: number): string | null {
  if (shareIssues === 0 && monthsOld <= 36) return "no equity issued";
  return null;
}

/**
 * Amount raised is NOT derivable here, and it is worth recording why.
 *
 * SH01 `description_values.capital.figure` is the company's total NOMINAL share
 * capital after the allotment, not the cash received. Fractile's is GBP 10.55
 * across 25 allotments; the company has raised many millions. Nominal value and
 * money in are unrelated, because shares are issued at a premium. Recovering the
 * real figure needs the scanned SH01 document or a paid data provider.
 */
export const AMOUNT_NOT_DERIVABLE =
  "SH01 reports nominal share capital, not cash raised";

/**
 * Company maturity, for sourcing relevance.
 *
 * `thesis_fit_score` measures DURABILITY, and mature winners are maximally
 * durable — Wise and Revolut correctly score 8-9. But durability is the wrong
 * lens for sourcing: a company worth billions is not actionable for an
 * early-stage fund, and letting those sit at the top of the ranking makes the
 * tool useless for its actual job.
 *
 * Companies House accounts type is a free, filed size proxy:
 *   (none)                  - no accounts yet, so incorporated within ~2 years
 *   micro-entity            - under ~GBP 632k turnover
 *   total-exemption / small - under ~GBP 10.2m turnover
 *   full / group            - above that, or listed
 */
export type Maturity = "early" | "growing" | "mature";

export function maturityFrom(
  accountsType: string | null | undefined,
  monthsOld: number,
): Maturity {
  const t = (accountsType ?? "").toLowerCase();
  if (/full|group|audited/.test(t) && !/total-exemption/.test(t)) return "mature";
  if (monthsOld > 144) return "mature";               // 12+ years
  if (!t) return monthsOld <= 36 ? "early" : "growing";
  if (/micro/.test(t)) return monthsOld <= 72 ? "early" : "growing";
  if (/small|total-exemption|dormant/.test(t)) return "growing";
  return "growing";
}

/** Normalized comparison key for matching an extracted name to the register. */
export function registerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(limited|ltd|plc|llp|inc|incorporated|company|holdings|group|uk|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Score a candidate register entry against the name we are looking for.
 * Exact normalized equality is the only high-confidence case; everything else
 * is reported low so the caller can decide whether to store it.
 */
export function matchScore(wanted: string, candidateTitle: string): number {
  const a = registerKey(wanted);
  const b = registerKey(candidateTitle);
  if (!a || !b) return 0;
  if (a === b) return 10;
  if (b.startsWith(a) && a.length >= 6) return 7;
  if (a.startsWith(b) && b.length >= 6) return 6;
  return 0;
}
