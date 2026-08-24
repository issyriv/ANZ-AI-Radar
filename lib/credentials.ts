// Founder credentials from free scholarly sources.
//
// At seed there is no revenue, no retention curve and often no product, so the
// team IS the evidence. Everything else in this pipeline judges a company by
// what it says about itself; this judges the people by what the record says.
//
// Semantic Scholar's Graph API is unauthenticated and free, and it settled
// Cursive AI in one call: Olivier Hénaff, 19 papers / 2,133 citations / h-index
// 11. That is a stronger legitimacy signal than any portfolio-page blurb.
//
// Names are ambiguous, so this is deliberately conservative: it reports the best
// match and how confident that match is, and never silently attaches a stranger's
// citation record to a founder.

const S2 = "https://api.semanticscholar.org/graph/v1";

export interface ScholarProfile {
  name: string;
  paperCount: number;
  citationCount: number;
  hIndex: number;
  affiliations: string[];
  authorId: string;
  /** 1-10. Name-match confidence, NOT research quality. */
  matchConfidence: number;
}

const STOP = /\b(dr|prof|professor|mr|mrs|ms|sir|dame|phd)\b\.?/gi;

export function cleanPersonName(raw: string): string {
  // Companies House gives "SURNAME, Forename Middle"; scholarly sources use
  // natural order, so they have to be reconciled before any lookup.
  const t = raw.replace(STOP, " ").replace(/\s+/g, " ").trim();
  const m = t.match(/^([^,]+),\s*(.+)$/);
  const natural = m ? `${m[2]} ${m[1]}` : t;
  return natural
    // Strip diacritics FIRST. The a-z filter below turns "Hénaff" into "h naff",
    // so the surname never matches and a 2,133-citation researcher reads as
    // having no record at all.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]\b/g, "") // drop lone initials; they wreck name matching
    .replace(/\s+/g, " ")
    .trim();
}

/** Do two names plausibly refer to the same person? */
function nameAgreement(wanted: string, found: string): number {
  const a = cleanPersonName(wanted).split(" ").filter(Boolean);
  const b = cleanPersonName(found).split(" ").filter(Boolean);
  if (!a.length || !b.length) return 0;
  const surnameMatch = a[a.length - 1] === b[b.length - 1];
  if (!surnameMatch) return 0;
  const firstMatch = a[0] === b[0];
  // "O. Hénaff" vs "Olivier Hénaff": surname agrees, forename is an initial.
  const firstInitial = a[0][0] === b[0][0];
  // Middle names are inconsistently recorded, so first+surname agreement is the
  // strong signal and an extra middle token must not demote it.
  if (firstMatch && a.length === b.length) return 9;
  if (firstMatch) return 9;
  if (firstInitial) return 5;
  return 3;
}

/**
 * Best scholarly profile for a person, or null.
 *
 * Ranks by name agreement first, then h-index — NOT by raw citations. Sorting on
 * citations alone picked a profile with 1,002 citations but an h-index of 4 for
 * a researcher whose real record was 8 papers / 368 citations / h-index 6: one
 * viral or wrongly-merged paper outranks a genuine body of work. h-index is the
 * more robust discriminator, and name agreement has to dominate either way.
 */
export async function lookupScholar(personName: string): Promise<ScholarProfile | null> {
  const full = cleanPersonName(personName).split(" ").filter(Boolean);
  if (full.length < 2) return null; // one token cannot identify anyone
  // Search on forename + surname only. Including a middle name stops the index
  // matching: "olivier jean henaff" returns nothing, "olivier henaff" returns a
  // 2,133-citation researcher.
  const q = `${full[0]} ${full[full.length - 1]}`;
  let data: { data?: Record<string, unknown>[] };
  try {
    const res = await fetch(
      `${S2}/author/search?query=${encodeURIComponent(q)}&fields=name,affiliations,paperCount,citationCount,hIndex&limit=8`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return null;
    data = (await res.json()) as { data?: Record<string, unknown>[] };
  } catch {
    return null;
  }
  const cands = (data.data ?? [])
    .map((a) => ({
      name: String(a.name ?? ""),
      paperCount: Number(a.paperCount ?? 0),
      citationCount: Number(a.citationCount ?? 0),
      hIndex: Number(a.hIndex ?? 0),
      affiliations: (a.affiliations as string[]) ?? [],
      authorId: String(a.authorId ?? ""),
      matchConfidence: nameAgreement(personName, String(a.name ?? "")),
    }))
    .filter((a) => a.matchConfidence >= 5 && a.paperCount > 0);
  if (!cands.length) return null;
  cands.sort(
    (x, y) =>
      y.matchConfidence - x.matchConfidence ||
      y.hIndex - x.hIndex ||
      y.citationCount - x.citationCount,
  );
  return cands[0];
}

export interface TeamCredentials {
  people: { name: string; scholar: ScholarProfile | null }[];
  researchers: number;
  topCitations: number;
  topHIndex: number;
  /** 0-10 team-strength signal, deliberately coarse. */
  score: number;
}

/**
 * Coarse team signal. A single highly-cited researcher matters more than several
 * lightly-published ones, so this keys off the strongest member rather than a
 * sum — a deep-tech company usually has one scientific centre of gravity.
 */
export function scoreTeam(people: { name: string; scholar: ScholarProfile | null }[]): TeamCredentials {
  const withS = people.filter((p) => p.scholar);
  const topCitations = Math.max(0, ...withS.map((p) => p.scholar!.citationCount));
  const topHIndex = Math.max(0, ...withS.map((p) => p.scholar!.hIndex));
  // Keyed on h-index, not raw citations. Citations alone rank a single viral or
  // wrongly-merged paper above a real body of work: an h-index-1 author with 684
  // citations outscored an h-index-6 author with 368, which inverted the ranking
  // of two teams whose relative strength was not in doubt.
  let s = 0;
  if (topHIndex >= 25) s = 10;
  else if (topHIndex >= 15) s = 9;
  else if (topHIndex >= 10) s = 8;
  else if (topHIndex >= 6) s = 7;
  else if (topHIndex >= 3) s = 5;
  else if (topHIndex >= 1) s = 3;
  else if (withS.length) s = 2;
  // A lone hit with a big citation count and no depth is usually a bad match.
  if (topHIndex <= 1 && topCitations > 300) s = Math.min(s, 3);
  if (withS.length >= 2) s = Math.min(10, s + 1); // more than one researcher
  return { people, researchers: withS.length, topCitations, topHIndex, score: s };
}
