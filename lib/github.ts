// Minimal GitHub REST client: auth, rate-limit + secondary-limit handling,
// pagination. Plain fetch, no SDK. Errors log-and-throw; callers decide to skip.

const BASE = "https://api.github.com";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeaders(accept = "application/vnd.github+json"): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  if (!token || token.includes("TODO")) {
    throw new Error("GITHUB_TOKEN not set in .env.local");
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "london-ai-radar",
  };
}

interface GhResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

// Core request with retry on rate limits (primary + secondary) and 5xx.
export async function ghRequest<T>(
  path: string,
  opts: { accept?: string; maxRetries?: number } = {},
): Promise<GhResponse<T>> {
  const { accept, maxRetries = 5 } = opts;
  const url = path.startsWith("http") ? path : `${BASE}${path}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers: authHeaders(accept) });

    if (res.ok) {
      return { data: (await res.json()) as T, headers: res.headers, status: res.status };
    }

    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const retryAfter = res.headers.get("retry-after");

    // Primary rate limit exhausted -> wait until reset.
    if ((res.status === 403 || res.status === 429) && remaining === "0" && reset) {
      const waitMs = Math.max(0, Number(reset) * 1000 - Date.now()) + 1500;
      console.warn(`[gh] rate limit hit, sleeping ${Math.round(waitMs / 1000)}s (${path})`);
      await sleep(waitMs);
      continue;
    }

    // Secondary rate limit / abuse detection -> honor Retry-After or back off.
    if (res.status === 403 || res.status === 429) {
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 2000 * (attempt + 1);
      console.warn(`[gh] secondary limit, sleeping ${Math.round(waitMs / 1000)}s (${path})`);
      await sleep(waitMs);
      continue;
    }

    // Transient server errors -> exponential backoff.
    if (res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} for ${path}: ${body.slice(0, 200)}`);
  }
  throw new Error(`GitHub request failed after ${maxRetries} retries: ${path}`);
}

// Throttle the Search API specifically (30 req/min authenticated).
let lastSearchAt = 0;
export async function ghSearchThrottle() {
  const minGap = 2100; // ~28/min, safely under the 30/min cap
  const since = Date.now() - lastSearchAt;
  if (since < minGap) await sleep(minGap - since);
  lastSearchAt = Date.now();
}

// --- typed-ish convenience shapes (only the fields we use) ------------------

export interface GhUserLite {
  login: string;
  id: number;
}

export interface GhUser {
  login: string;
  id: number;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  hireable: boolean | null;
  bio: string | null;
  twitter_username: string | null;
  avatar_url: string;
  html_url: string;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
  updated_at: string;
}

export interface GhRepo {
  name: string;
  full_name: string;
  description: string | null;
  fork: boolean;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  owner: { login: string };
}

export interface GhStarred {
  starred_at: string;
  repo: GhRepo;
}

export interface GhEvent {
  type: string;
  created_at: string;
  repo: { name: string };
  payload?: unknown;
}

export async function searchUsers(
  q: string,
  page = 1,
  perPage = 100,
): Promise<{ total_count: number; items: GhUserLite[] }> {
  await ghSearchThrottle();
  const path = `/search/users?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`;
  const { data } = await ghRequest<{ total_count: number; items: GhUserLite[] }>(path);
  return data;
}

export async function getUser(login: string): Promise<GhUser> {
  const { data } = await ghRequest<GhUser>(`/users/${login}`);
  return data;
}

export async function getUserRepos(login: string, max = 100): Promise<GhRepo[]> {
  const { data } = await ghRequest<GhRepo[]>(
    `/users/${login}/repos?sort=pushed&per_page=${Math.min(max, 100)}`,
  );
  return data;
}

export async function getUserStarred(login: string, max = 100): Promise<GhStarred[]> {
  // star+json accept header returns { starred_at, repo }
  const { data } = await ghRequest<GhStarred[]>(
    `/users/${login}/starred?per_page=${Math.min(max, 100)}&sort=created`,
    { accept: "application/vnd.github.star+json" },
  );
  return data;
}

export async function getUserEvents(login: string): Promise<GhEvent[]> {
  // Public events: most recent ~90 days / 300 events max from GitHub.
  const { data } = await ghRequest<GhEvent[]>(`/users/${login}/events/public?per_page=100`);
  return data;
}
