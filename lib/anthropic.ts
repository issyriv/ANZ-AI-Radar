import Anthropic from "@anthropic-ai/sdk";

export const HAIKU = "claude-haiku-4-5"; // bulk enrichment (cheap)
export const SONNET = "claude-sonnet-4-6"; // reasoning-heavy steps

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes("TODO")) {
    throw new Error("ANTHROPIC_API_KEY not set in .env.local");
  }
  // High maxRetries so the SDK self-throttles against tier-1 rate limits
  // (it honors retry-after on 429s).
  _client = new Anthropic({ apiKey, maxRetries: 8 });
  return _client;
}
