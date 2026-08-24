// Central config for the crawl + enrichment. UK-focused, London-weighted.

// GitHub user-search location queries. London first and most heavily paged
// (it is the point of the tool), then the other UK tech hubs, then a
// country-level catch-all. `bucket` is what we normalize to for the UI filter.
export const LOCATION_QUERIES: { query: string; bucket: string; weight: number }[] = [
  { query: "London", bucket: "London", weight: 6 },
  { query: "Cambridge", bucket: "Cambridge" , weight: 2 },
  { query: "Oxford", bucket: "Oxford", weight: 2 },
  { query: "Manchester", bucket: "Manchester", weight: 1 },
  { query: "Bristol", bucket: "Bristol", weight: 1 },
  { query: "Edinburgh", bucket: "Edinburgh", weight: 1 },
  { query: "Glasgow", bucket: "Glasgow", weight: 1 },
  { query: "Birmingham", bucket: "Birmingham", weight: 1 },
  { query: "Leeds", bucket: "Leeds", weight: 1 },
  { query: "Brighton", bucket: "Brighton", weight: 1 },
  { query: "Reading", bucket: "Reading", weight: 1 },
  { query: "Cardiff", bucket: "Cardiff", weight: 1 },
  { query: "Belfast", bucket: "Belfast", weight: 1 },
  { query: "United Kingdom", bucket: "United Kingdom", weight: 1 },
  { query: "England", bucket: "United Kingdom", weight: 1 },
];

// Distinct location buckets, for the UI filter dropdown.
export const LOCATION_BUCKETS = Array.from(
  new Set(LOCATION_QUERIES.map((l) => l.bucket)),
);

// Seed AI repos: activity in / starring of these is a strong signal. Kept
// current with the frontier inference, agent and eval stacks.
export const SEED_AI_REPOS = [
  "vllm-project/vllm",
  "huggingface/transformers",
  "langchain-ai/langchain",
  "langchain-ai/langgraph",
  "run-llama/llama_index",
  "anthropics/anthropic-sdk-python",
  "anthropics/anthropic-sdk-typescript",
  "anthropics/claude-code",
  "modelcontextprotocol/servers",
  "modelcontextprotocol/python-sdk",
  "openai/openai-python",
  "modal-labs/modal",
  "ollama/ollama",
  "ggml-org/llama.cpp",
  "openai/evals",
  "microsoft/autogen",
  "crewAIInc/crewAI",
  "deepset-ai/haystack",
  "pydantic/pydantic-ai",
  "BerriAI/litellm",
  "sgl-project/sglang",
  "unslothai/unsloth",
  "huggingface/peft",
  "chroma-core/chroma",
  "qdrant/qdrant",
  "weaviate/weaviate",
  "stanfordnlp/dspy",
  "comfyanonymous/ComfyUI",
  "browser-use/browser-use",
  "All-Hands-AI/OpenHands",
];

// Any repo whose name/description contains one of these is treated as AI-relevant.
export const AI_TERMS = [
  "agent", "rag", "llm", "eval", "anthropic", "openai", "gpt", "claude",
  "embedding", "vector", "inference", "fine-tun", "diffusion", "transformer",
  "mcp", "prompt", "multimodal", "vlm", "retrieval",
];

// AI-relevant term detection for a repo (by name + description).
export function repoLooksAI(name: string, description: string | null): boolean {
  const hay = `${name} ${description ?? ""}`.toLowerCase();
  return AI_TERMS.some((t) => hay.includes(t));
}

// --- Fuzzy location normalization -------------------------------------------
// Users self-write locations ("London 🇬🇧", "based in Shoreditch", "Cambs").
// Map to a bucket; fall back to the city we searched under. Accept false positives.
const CITY_PATTERNS: { re: RegExp; bucket: string }[] = [
  // London and its tech clusters / common self-descriptions.
  { re: /\blondon\b|\bldn\b|\bshoreditch\b|\bhackney\b|\bcanary wharf\b|\bsoho\b|\bkings cross\b|\bking's cross\b|\bclerkenwell\b|\bsilicon roundabout\b/i, bucket: "London" },
  { re: /\bcambridge\b|\bcambs\b|\bsilicon fen\b/i, bucket: "Cambridge" },
  { re: /\boxford\b|\boxon\b/i, bucket: "Oxford" },
  { re: /\bmanchester\b|\bmcr\b|\bsalford\b/i, bucket: "Manchester" },
  { re: /\bbristol\b|\bbath\b/i, bucket: "Bristol" },
  { re: /\bedinburgh\b|\bedi\b/i, bucket: "Edinburgh" },
  { re: /\bglasgow\b/i, bucket: "Glasgow" },
  { re: /\bbirmingham\b|\bbrum\b/i, bucket: "Birmingham" },
  { re: /\bleeds\b/i, bucket: "Leeds" },
  { re: /\bbrighton\b|\bhove\b/i, bucket: "Brighton" },
  { re: /\breading\b|\bthames valley\b/i, bucket: "Reading" },
  { re: /\bcardiff\b|\bcaerdydd\b/i, bucket: "Cardiff" },
  { re: /\bbelfast\b/i, bucket: "Belfast" },
];

// Non-UK cities that share a name with a UK one. "Cambridge, MA" and
// "Birmingham, AL" would otherwise be normalized into the UK buckets, which is
// the single biggest false-positive source in the whole location pipeline.
const AMBIGUOUS_NON_UK =
  /\b(ma|mass|massachusetts|al|alabama|on|ontario|nz|new zealand|australia|nsw|vic|usa|u\.s\.a?|united states|canada|germany|france|spain|india|pakistan|nigeria|kenya|ghana|brazil|philippines|indonesia|bangladesh|south africa)\b/i;

export function normalizeLocation(
  raw: string | null,
  fallbackBucket?: string,
): string | null {
  if (!raw && fallbackBucket) return fallbackBucket;
  if (!raw) return null;
  const nonUk = AMBIGUOUS_NON_UK.test(raw) && !/\b(uk|u\.k\.|england|scotland|wales|britain|gb)\b/i.test(raw);
  for (const { re, bucket } of CITY_PATTERNS) {
    if (re.test(raw)) return nonUk ? null : bucket;
  }
  if (nonUk) return null;
  const lower = raw.toLowerCase();
  if (/🇬🇧|🏴󠁧󠁢󠁥󠁮󠁧󠁿/.test(raw) || /\bu\.?k\.?\b|united kingdom|\bengland\b|\bscotland\b|\bwales\b|\bbritain\b|\bbritish\b|\bgb\b/.test(lower)) {
    return "United Kingdom";
  }
  return fallbackBucket ?? null;
}

// Loose UK membership check — used to drop obvious non-UK false positives from
// the broad country-level searches.
export function looksUK(raw: string | null): boolean {
  if (!raw) return true; // empty -> keep (we found them via a location search)
  return normalizeLocation(raw) !== null;
}
