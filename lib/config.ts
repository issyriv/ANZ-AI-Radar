// Central config for the crawl + enrichment.

// GitHub user-search location queries. Cities first (high precision), then
// country-level catch-alls. The `bucket` is what we normalize to for the UI filter.
export const LOCATION_QUERIES: { query: string; bucket: string }[] = [
  { query: "Sydney", bucket: "Sydney, AU" },
  { query: "Melbourne", bucket: "Melbourne, AU" },
  { query: "Brisbane", bucket: "Brisbane, AU" },
  { query: "Perth", bucket: "Perth, AU" },
  { query: "Adelaide", bucket: "Adelaide, AU" },
  { query: "Canberra", bucket: "Canberra, AU" },
  { query: "Auckland", bucket: "Auckland, NZ" },
  { query: "Wellington", bucket: "Wellington, NZ" },
  { query: "Christchurch", bucket: "Christchurch, NZ" },
  { query: "Australia", bucket: "Australia" },
  { query: "New Zealand", bucket: "New Zealand" },
];

// Distinct location buckets, for the UI filter dropdown.
export const LOCATION_BUCKETS = Array.from(
  new Set(LOCATION_QUERIES.map((l) => l.bucket)),
);

// Seed AI repos: activity in / starring of these is a strong signal.
export const SEED_AI_REPOS = [
  "vllm-project/vllm",
  "huggingface/transformers",
  "langchain-ai/langchain",
  "run-llama/llama_index",
  "anthropics/anthropic-sdk-python",
  "openai/openai-python",
  "modal-labs/modal",
  "ollama/ollama",
  "openai/evals",
  "microsoft/autogen",
  "joaomdmoura/crewai",
  "deepset-ai/haystack",
];

// Any repo whose name/description contains one of these is treated as AI-relevant.
export const AI_TERMS = ["agent", "rag", "llm", "eval", "anthropic", "openai", "gpt", "embedding", "vector", "inference", "fine-tun", "diffusion"];

// Airtree portfolio / alumni companies. Ex-employees of these are worth flagging.
// NOTE: seeded with the examples from the brief — user to finalize the canonical list.
// `aliases` are matched case-insensitively against candidate company/bio/email-domain.
export const AIRTREE_ALUMNI: { name: string; aliases: string[] }[] = [
  { name: "Canva", aliases: ["canva", "@canva.com"] },
  { name: "Atlassian", aliases: ["atlassian", "@atlassian.com"] },
  { name: "SafetyCulture", aliases: ["safetyculture", "safety culture", "@safetyculture.com", "@safetyculture.io"] },
  { name: "Linktree", aliases: ["linktree", "@linktr.ee", "@linktree.com"] },
  { name: "Employment Hero", aliases: ["employment hero", "employmenthero", "@employmenthero.com"] },
  { name: "Airwallex", aliases: ["airwallex", "@airwallex.com"] },
  { name: "Immutable", aliases: ["immutable", "@immutable.com"] },
];

// AI-relevant term detection for a repo (by name + description).
export function repoLooksAI(name: string, description: string | null): boolean {
  const hay = `${name} ${description ?? ""}`.toLowerCase();
  return AI_TERMS.some((t) => hay.includes(t));
}

// --- Fuzzy location normalization -------------------------------------------
// Users self-write locations ("Sydney 🇦🇺", "based in melb", "Aotearoa").
// Map to a bucket; fall back to the city we searched under. Accept false positives.
const CITY_PATTERNS: { re: RegExp; bucket: string }[] = [
  { re: /\bsyd(ney)?\b/i, bucket: "Sydney, AU" },
  { re: /\bmel(b|bourne)?\b/i, bucket: "Melbourne, AU" },
  { re: /\bbris(bane|vegas)?\b/i, bucket: "Brisbane, AU" },
  { re: /\bperth\b/i, bucket: "Perth, AU" },
  { re: /\badelaide\b/i, bucket: "Adelaide, AU" },
  { re: /\bcanberra\b/i, bucket: "Canberra, AU" },
  { re: /\bauck(land)?\b/i, bucket: "Auckland, NZ" },
  { re: /\bwell(y|ington)?\b/i, bucket: "Wellington, NZ" },
  { re: /\bchch\b|\bchristchurch\b/i, bucket: "Christchurch, NZ" },
];

export function normalizeLocation(raw: string | null, fallbackBucket?: string): string | null {
  if (!raw && fallbackBucket) return fallbackBucket;
  if (!raw) return null;
  for (const { re, bucket } of CITY_PATTERNS) {
    if (re.test(raw)) return bucket;
  }
  const lower = raw.toLowerCase();
  if (/🇦🇺/.test(raw) || /\baustralia\b|\baussie\b|\b, ?au\b|\boz\b/.test(lower)) return "Australia";
  if (/🇳🇿/.test(raw) || /new zealand|aotearoa|\b, ?nz\b/.test(lower)) return "New Zealand";
  return fallbackBucket ?? null;
}

// Loose ANZ membership check — used to drop obvious non-ANZ false positives
// from the broad "Australia"/"New Zealand" country searches.
export function looksANZ(raw: string | null): boolean {
  if (!raw) return true; // empty -> keep (we found them via a location search)
  return normalizeLocation(raw) !== null;
}
