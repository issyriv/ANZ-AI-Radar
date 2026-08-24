// Companies House REST client.
//
// This is the pre-announcement layer. Every other source in this repo lists
// companies that already have an investor or press coverage, which by
// definition excludes anything undiscovered. The UK register does not: a
// company must file its incorporation within weeks of forming, long before it
// announces anything.
//
// Auth is HTTP Basic with the API key as the username and an empty password.
// Rate limit is 600 requests per 5 minutes, enforced here with a token bucket
// so a long crawl throttles itself rather than getting 429'd off.

const BASE = "https://api.company-information.service.gov.uk";
const RATE_LIMIT = Number(process.env.CH_RATE_LIMIT ?? 550); // per 5 min, under the 600 cap
const WINDOW_MS = 5 * 60 * 1000;

export function hasKey(): boolean {
  const k = process.env.COMPANIES_HOUSE_API_KEY;
  return !!k && !k.includes("TODO");
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key || key.includes("TODO")) {
    throw new Error(
      "COMPANIES_HOUSE_API_KEY not set in .env.local — get a free key at " +
        "https://developer.company-information.service.gov.uk/",
    );
  }
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

// --- self-throttling --------------------------------------------------------
const callTimes: number[] = [];

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] > WINDOW_MS) callTimes.shift();
    if (callTimes.length < RATE_LIMIT) {
      callTimes.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - callTimes[0]) + 250;
    console.log(`[ch] rate window full, sleeping ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function chGet<T>(path: string, retries = 4): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (attempt === retries) {
        console.error(`[ch] ${path}: ${(e as Error).message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }

    if (res.ok) return (await res.json()) as T;
    // 404 is a legitimate answer for "this company has no officers record".
    if (res.status === 404) return null;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      const waitMs = retryAfter ? retryAfter * 1000 : 30_000;
      console.warn(`[ch] 429, sleeping ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (res.status === 401) {
      throw new Error("Companies House rejected the API key (401). Check COMPANIES_HOUSE_API_KEY.");
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    console.error(`[ch] ${path}: HTTP ${res.status}`);
    return null;
  }
  return null;
}

// --- shapes (only the fields we read) ---------------------------------------

export interface ChCompany {
  company_number: string;
  company_name: string;
  company_status: string;          // active | dissolved | liquidation | ...
  company_type: string;            // ltd | plc | llp | ...
  date_of_creation: string;        // YYYY-MM-DD
  sic_codes?: string[];
  registered_office_address?: {
    locality?: string; postal_code?: string; region?: string; address_line_1?: string;
  };
  accounts?: {
    last_accounts?: { type?: string; made_up_to?: string };
    next_due?: string;
  };
}

export interface ChOfficer {
  name: string;                    // "SURNAME, Forename Middle"
  officer_role: string;            // director | secretary | ...
  appointed_on?: string;
  resigned_on?: string;
  occupation?: string;
  nationality?: string;
  country_of_residence?: string;
  date_of_birth?: { month: number; year: number };
  links?: { officer?: { appointments?: string } };
}

export interface ChFiling {
  category?: string;               // capital | accounts | officers | ...
  type?: string;                   // SH01 | AP01 | ...
  date?: string;
  description?: string;
}

export interface ChAppointment {
  appointed_to?: { company_number?: string; company_name?: string; company_status?: string };
  appointed_on?: string;
  resigned_on?: string;
  officer_role?: string;
}

/**
 * Advanced search over the register. This is the only endpoint that can filter
 * by SIC code AND incorporation date together, which is what makes a targeted
 * "new AI-ish companies" sweep possible at all.
 */
export async function advancedSearch(opts: {
  sicCodes?: string[];
  incorporatedFrom?: string; // YYYY-MM-DD
  incorporatedTo?: string;
  location?: string;
  size?: number;             // max 5000 per the API
  startIndex?: number;
  status?: string[];
}): Promise<{ items: ChCompany[]; hits: number }> {
  const q = new URLSearchParams();
  for (const sic of opts.sicCodes ?? []) q.append("sic_codes", sic);
  for (const s of opts.status ?? ["active"]) q.append("company_status", s);
  if (opts.incorporatedFrom) q.set("incorporated_from", opts.incorporatedFrom);
  if (opts.incorporatedTo) q.set("incorporated_to", opts.incorporatedTo);
  if (opts.location) q.set("location", opts.location);
  q.set("size", String(opts.size ?? 100));
  q.set("start_index", String(opts.startIndex ?? 0));

  const data = await chGet<{ items?: ChCompany[]; hits?: number }>(
    `/advanced-search/companies?${q.toString()}`,
  );
  return { items: data?.items ?? [], hits: data?.hits ?? 0 };
}

export interface ChOfficerSearchResult {
  title: string;                    // "SURNAME, Forename"
  description?: string;
  address_snippet?: string;
  links?: { self?: string };        // "/officers/{id}/appointments"
}

/**
 * Search the officer index by person name. This is the cheap direction: one
 * call per person we already care about, rather than one call per company in a
 * sweep of tens of thousands of incorporations.
 */
export async function searchOfficers(
  name: string,
  itemsPerPage = 20,
): Promise<ChOfficerSearchResult[]> {
  const data = await chGet<{ items?: ChOfficerSearchResult[] }>(
    `/search/officers?q=${encodeURIComponent(name)}&items_per_page=${itemsPerPage}`,
  );
  return data?.items ?? [];
}

export interface ChCompanySearchResult {
  title: string;
  company_number: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  address_snippet?: string;
}

/** Search the company index by name. */
export async function searchCompanies(
  name: string,
  itemsPerPage = 10,
): Promise<ChCompanySearchResult[]> {
  const data = await chGet<{ items?: ChCompanySearchResult[] }>(
    `/search/companies?q=${encodeURIComponent(name)}&items_per_page=${itemsPerPage}`,
  );
  return data?.items ?? [];
}

export async function getCompany(companyNumber: string): Promise<ChCompany | null> {
  return chGet<ChCompany>(`/company/${companyNumber}`);
}

export async function getOfficers(companyNumber: string): Promise<ChOfficer[]> {
  const data = await chGet<{ items?: ChOfficer[] }>(
    `/company/${companyNumber}/officers?items_per_page=50`,
  );
  return data?.items ?? [];
}

export async function getFilingHistory(companyNumber: string): Promise<ChFiling[]> {
  const data = await chGet<{ items?: ChFiling[] }>(
    `/company/${companyNumber}/filing-history?items_per_page=100`,
  );
  return data?.items ?? [];
}

/** Every other company this person is or was a director of. */
export async function getOfficerAppointments(appointmentsPath: string): Promise<ChAppointment[]> {
  const data = await chGet<{ items?: ChAppointment[] }>(
    `${appointmentsPath}?items_per_page=50`,
  );
  return data?.items ?? [];
}

/**
 * "SURNAME, Forename Middle" -> "Forename Middle Surname".
 * Companies House stores officer names surname-first in caps; every other
 * source in this repo (GitHub, news, portfolio pages) uses natural order, so
 * they have to be reconciled before any cross-reference can match.
 */
export function normalizeOfficerName(chName: string): string {
  const raw = chName.trim().replace(/\s+/g, " ");
  const m = raw.match(/^([^,]+),\s*(.+)$/);
  const natural = m ? `${m[2]} ${m[1]}` : raw;
  return natural
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady)\b\.?/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A share allotment (SH01) is what a raise looks like on the register. */
export function hasShareAllotment(filings: ChFiling[]): boolean {
  return filings.some((f) => (f.type ?? "").toUpperCase() === "SH01");
}
