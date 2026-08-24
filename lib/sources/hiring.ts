// Hacker News "Who is hiring?" as a sourcing channel.
//
// This exists because of a specific miss. Cursive AI — a London frontier-AI lab
// with three PhD founders and two funding rounds — was invisible to every source
// in the registry, because every one of them lists companies that already have
// an investor or press. But Cursive was HIRING, and a stealth company that is
// hiring has to post the role somewhere public.
//
// HN's monthly thread is the best free version of that signal: ~250 posts a
// month, ~20 of them London/UK, most of those AI-adjacent, in a semi-structured
// format ("Company | Role | Location | ..."). The Algolia API is free and
// unauthenticated, and company names parse deterministically, so this whole
// source costs nothing to run.

const ALGOLIA = "https://hn.algolia.com/api/v1";

export interface HiringPost {
  company: string;
  threadId: string;
  threadDate: string;
  url: string | null;
  text: string;
}

interface AlgoliaHit { objectID: string; title?: string; created_at?: string; num_comments?: number }

/** The monthly threads, newest first. */
export async function whoIsHiringThreads(max = 12): Promise<AlgoliaHit[]> {
  const res = await fetch(
    `${ALGOLIA}/search_by_date?query=${encodeURIComponent('"Who is hiring"')}&tags=story,author_whoishiring&hitsPerPage=${max}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return [];
  const d = (await res.json()) as { hits?: AlgoliaHit[] };
  return (d.hits ?? []).filter((h) => /who is hiring/i.test(h.title ?? ""));
}

function decode(s: string): string {
  return s
    .replace(/<p>/gi, " \n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Company name from an HN hiring post.
 *
 * The convention is "Company | Role | Location | ..." but it is a convention,
 * not a format — plenty of posts lead with a URL, a location, or prose. We take
 * the first pipe-delimited segment and reject anything that does not look like a
 * name, which is cheaper and more predictable than asking a model.
 */
const NOT_A_NAME =
  /^(london|uk|united kingdom|england|scotland|wales|cambridge|oxford|manchester|bristol|edinburgh|remote|onsite|hybrid|hiring|we|our team|about us|location|role|position|job|full.?time|part.?time|contract|intern|senior|junior|staff|principal|engineer|developer|scientist)$/i;

/** "literal-labs.ai" -> "Literal Labs". Used when the leading segment is junk. */
function nameFromUrl(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  // Job-board and link-shortener hosts say nothing about the company.
  if (/ashbyhq|greenhouse|lever\.co|workable|linkedin|lnkd\.in|tinyurl|bit\.ly|youtube|stackoverflow|notion\.site|google\.com|forms\./i.test(host)) {
    return null;
  }
  const core = host.replace(/^www\./, "").split(".")[0];
  if (!core || core.length < 3) return null;
  return core
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Company name from an HN hiring post.
 *
 * The convention is "Company | Role | Location | ..." but it is a convention,
 * not a format — plenty of posts lead with a location, a role, or prose. When
 * the leading segment is not a name we fall back to the company's own domain,
 * which recovered "Literal Labs" from a post that began "London".
 */
export function parseCompany(text: string, url: string | null = null): string | null {
  const first = (text.split("|")[0] ?? "").trim().replace(/\s*[-–—,(].*$/, "").trim();
  const usable =
    first &&
    first.length >= 3 &&
    first.length <= 48 &&
    !/^https?:|^www\./i.test(first) &&
    !NOT_A_NAME.test(first) &&
    !/\b(remote|onsite|hybrid|full.?time|part.?time)\b/i.test(first) &&
    first.split(/\s+/).length <= 6 &&
    /[A-Za-z]{3}/.test(first);
  return usable ? first : nameFromUrl(url);
}

const UK_RE = /\b(london|united kingdom|\buk\b|cambridge|oxford|manchester|bristol|edinburgh|glasgow|leeds|england|scotland|wales)\b/i;
const AI_RE = /\b(ai|a\.i|ml|llm|machine learning|deep learning|agent|agentic|foundation model|research scientist|nlp|computer vision|robotic|autonomous|inference|rl|reinforcement learning)\b/i;

export function isUkAiPost(text: string): boolean {
  return UK_RE.test(text) && AI_RE.test(text);
}

/** Every UK + AI hiring post across the last `months` threads. */
export async function collectUkAiHiring(months = 12): Promise<HiringPost[]> {
  const threads = await whoIsHiringThreads(months);
  const out: HiringPost[] = [];
  for (const t of threads) {
    const res = await fetch(`${ALGOLIA}/items/${t.objectID}`, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) continue;
    const item = (await res.json()) as { children?: { text?: string }[] };
    for (const child of item.children ?? []) {
      const text = decode(child.text ?? "");
      if (!text || !isUkAiPost(text)) continue;
      const url = text.match(/https?:\/\/[^\s|)]+/)?.[0] ?? null;
      const company = parseCompany(text, url);
      if (!company) continue;
      out.push({ company, threadId: t.objectID, threadDate: (t.created_at ?? "").slice(0, 10), url, text });
    }
  }
  return out;
}
