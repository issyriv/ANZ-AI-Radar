// Signal definitions for the Companies House pre-announcement layer.

/**
 * SIC codes a software / AI / deep-tech company plausibly registers under.
 * 62012 and 62020 are by far the most common and also the noisiest — tens of
 * thousands of consultancies and one-person contractor shells use them — which
 * is why the name and person filters below do the real work.
 */
export const AI_SIC_CODES = [
  "62012", // business and domestic software development
  "62020", // information technology consultancy
  "62090", // other information technology service activities
  "63110", // data processing, hosting and related activities
  "63120", // web portals
  "58290", // other software publishing
  "72190", // R&D on natural sciences and engineering
  "72110", // R&D on biotechnology
  "26200", // manufacture of computers and peripherals (robotics / hardware)
];

/**
 * Company-name tokens that signal an AI-native company.
 *
 * Two classes, because they fail differently. BARE tokens are short and
 * ambiguous, so they need a word boundary on both sides ("ai" as a substring
 * matches Air, Rail, Detail, Maintain and hundreds more). PREFIX tokens are
 * long enough to be unambiguous and routinely appear glued into compounds
 * ("NeuralFrame", "Cognita", "Inferencing"), so they match at a word start with
 * any suffix.
 */
const BARE_NAME_RE = /\b(ai|a\.i|agi|llm|ml|nlp|genai|mlops|rag)\b/i;

const PREFIX_NAME_RE =
  /\b(neural|cognit|agentic|agent|inferen|embedding|vector|copilot|autonom|reason|transformer|diffusion|deeptech|deep tech|foundation model|multimodal|semantic|synthetic|robotic)/i;

const SUFFIX_NAME_RE = /\b\w+(ai|ml)\b/i; // "Synthesia AI", "Peakml"

const GENERIC_SHELL_RE =
  /\b(holdings|properties|property|consulting|consultancy|estates|lettings|trading|logistics|transport|cleaning|catering|construction|builders|plumbing|recruitment|accountancy|accounting|solicitors|dental|clinic|salon|barbers|takeaway|restaurant|cafe|taxi|driving|scaffolding|roofing|landscaping|removals|couriers)\b/i;

/**
 * SIC codes consistent with a technology company, broader than AI_SIC_CODES.
 *
 * The person-anchored pathway needs this. Matching a developer on the talent
 * radar to a new directorship finds real companies, but developers incorporate
 * for mundane reasons: the first live run surfaced a property company, a shop, a
 * food business, a refrigeration contractor and a mountain-biking club, and the
 * +5 "radar director" bonus floated all of them to the top. The person tells you
 * nothing about the company — the SIC codes do.
 */
export const TECH_SIC_CODES = new Set([
  "62011", "62012", "62020", "62090",          // software dev / IT consultancy
  "63110", "63120", "63990",                    // data processing, portals, info services
  "58210", "58290",                             // software publishing
  "72110", "72190",                             // R&D
  "26110", "26120", "26200", "26300", "26400",  // electronics / computer hardware
  "27900", "28230",                             // other electrical / office machinery
  "71121", "71122",                             // engineering
  "74901", "74909",                             // other professional / technical
  "61900", "61100",                             // telecoms
  "82990",                                      // other business support (thin but common)
]);

/**
 * True when the company's filed SIC codes are consistent with a tech venture.
 * An empty list passes: freshly incorporated companies sometimes file none yet,
 * and excluding them would drop the newest — most interesting — formations.
 */
export function sicLooksTech(sicCodes: string[]): boolean {
  if (sicCodes.length === 0) return true;
  return sicCodes.some((c) => TECH_SIC_CODES.has(c.trim()));
}

export function nameLooksAI(name: string): boolean {
  if (GENERIC_SHELL_RE.test(name)) return false;
  return BARE_NAME_RE.test(name) || PREFIX_NAME_RE.test(name) || SUFFIX_NAME_RE.test(name);
}

/**
 * UK tech-hub postcode areas. A registered office is often an accountant's
 * address rather than where the team sits, so this is a weak positive signal,
 * never an exclusion.
 */
const HUB_POSTCODE_RE =
  /^(EC|WC|E|N|NW|SE|SW|W|CB|OX|M|BS|EH|G|LS|B|BN|RG|CF|BT|CM|GU|SL|TW|KT|CR|BR|DA|EN|HA|IG|RM|SM|UB|WD)\d/i;

export function inTechHub(postcode: string | undefined): boolean {
  if (!postcode) return false;
  return HUB_POSTCODE_RE.test(postcode.trim().toUpperCase());
}

export function hubCity(locality: string | undefined, postcode: string | undefined): string | null {
  const l = (locality ?? "").toLowerCase();
  if (/london|westminster|camden|hackney|islington|southwark|shoreditch/.test(l)) return "London";
  if (/cambridge/.test(l)) return "Cambridge";
  if (/oxford/.test(l)) return "Oxford";
  if (/manchester|salford/.test(l)) return "Manchester";
  if (/bristol|bath/.test(l)) return "Bristol";
  if (/edinburgh/.test(l)) return "Edinburgh";
  if (/glasgow/.test(l)) return "Glasgow";
  if (/leeds/.test(l)) return "Leeds";
  if (/birmingham/.test(l)) return "Birmingham";
  const pc = (postcode ?? "").trim().toUpperCase();
  if (/^(EC|WC|E|N|NW|SE|SW|W)\d/.test(pc)) return "London";
  if (/^CB\d/.test(pc)) return "Cambridge";
  if (/^OX\d/.test(pc)) return "Oxford";
  if (/^M\d/.test(pc)) return "Manchester";
  if (/^BS\d/.test(pc)) return "Bristol";
  if (/^EH\d/.test(pc)) return "Edinburgh";
  return null;
}

export function monthsSince(isoDate: string): number {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (30 * 86_400_000);
}

/**
 * One candidate formation, with the reasons it surfaced. `signals` is what makes
 * the output auditable — a row that cannot say why it is here is noise.
 */
export interface Formation {
  company_number: string;
  company_name: string;
  incorporated_on: string;
  months_old: number;
  sic_codes: string[];
  hq_city: string | null;
  postcode: string | null;
  officers: string[];          // natural-order names (active directors only)
  signals: string[];
  matched_candidate: string | null;  // github login, when person-anchored
  has_share_allotment: boolean;
  prior_companies: string[];
  score: number;               // deterministic pre-score, before any LLM call
}

/**
 * Deterministic score, computed before spending a single model call. The whole
 * point of the layer is that the expensive step only ever sees a shortlist.
 */
export function preScore(f: Omit<Formation, "score">): number {
  let s = 0;
  if (f.matched_candidate) s += 5;            // a known AI builder is a director
  if (nameLooksAI(f.company_name)) s += 1;    // weak on its own: anyone can name a shell "X AI Ltd"
  if (f.has_share_allotment) s += 3;          // shares actually issued to someone
  if (f.months_old <= 6) s += 3;              // the window where nobody has announced yet
  else if (f.months_old <= 12) s += 2;
  else if (f.months_old <= 24) s += 0.5;
  if (f.hq_city === "London") s += 1;
  else if (f.hq_city) s += 0.5;
  if (f.prior_companies.length > 0) s += 1;   // serial founder
  if (f.sic_codes.some((c) => ["72190", "72110", "26200"].includes(c))) s += 1.5; // deep tech
  // Director count is the single best free discriminator: in a calibration run,
  // 76% of name-sweep hits had one director, which is the shape of a contractor
  // personal service company, not a venture.
  if (f.officers.length >= 2) s += 2;
  else if (f.officers.length <= 1) s -= 2;
  // A company whose filed activity is not technology is not a lead, however
  // interesting its director is.
  if (!sicLooksTech(f.sic_codes)) s -= 6;
  return Math.round(s * 10) / 10;
}
