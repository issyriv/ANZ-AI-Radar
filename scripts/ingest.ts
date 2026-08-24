import "./_bootstrap";
import { backend, upsertCandidates } from "../lib/store";
import {
  LOCATION_QUERIES,
  SEED_AI_REPOS,
  repoLooksAI,
  normalizeLocation,
  looksUK,
} from "../lib/config";
import {
  searchUsers,
  getUser,
  getUserRepos,
  getUserStarred,
  getUserEvents,
  sleep,
  type GhUser,
  type GhRepo,
  type GhStarred,
  type GhEvent,
} from "../lib/github";
import type { RepoSummary, StarredRepoSummary } from "../lib/types";

// Tunables (override via env):
//   INGEST_TARGET=40 INGEST_MAX_SCAN=120 INGEST_PAGES_PER_QUERY=2 npm run ingest
const TARGET = Number(process.env.INGEST_TARGET ?? 500);
const MAX_SCAN = Number(process.env.INGEST_MAX_SCAN ?? 1400);
const PAGES_PER_QUERY = Number(process.env.INGEST_PAGES_PER_QUERY ?? 4);
// Follower buckets beat GitHub's 1,000-results-per-query search cap and reach the
// low-follower long tail (where stealth founders live). Low-weighted by default.
const FOLLOWER_BUCKETS = (
  process.env.INGEST_BUCKETS ?? "1..15,16..50,51..150,151..400,401..1200"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DAY = 86_400_000;
const SEED_SET = new Set(SEED_AI_REPOS.map((s) => s.toLowerCase()));

function toRepoSummary(r: GhRepo): RepoSummary {
  return {
    name: r.name,
    description: r.description,
    stars: r.stargazers_count,
    language: r.language,
    fork: r.fork,
    pushed_at: r.pushed_at,
    html_url: r.html_url,
  };
}

// Decide AI relevance + compute the signal fields from a user's GitHub footprint.
function evaluate(repos: GhRepo[], starred: GhStarred[], events: GhEvent[]) {
  const matched = new Set<string>();
  const contributed = new Set<string>();
  const starredAiSample: StarredRepoSummary[] = [];
  let starredAiCount = 0;
  let starredAi30d = 0;
  let lastAi = 0;
  const now = Date.now();
  const bump = (iso: string | null) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) lastAi = Math.max(lastAi, t);
  };

  for (const r of repos) {
    const isSeed = SEED_SET.has(r.full_name.toLowerCase());
    if (!r.fork && (isSeed || repoLooksAI(r.name, r.description))) {
      matched.add(`owns:${r.name}`);
      bump(r.pushed_at);
    }
  }

  for (const s of starred) {
    if (!s.repo) continue;
    const isSeed = SEED_SET.has(s.repo.full_name.toLowerCase());
    if (isSeed || repoLooksAI(s.repo.name, s.repo.description)) {
      starredAiCount++;
      if (s.starred_at) {
        if (Date.parse(s.starred_at) > now - 30 * DAY) starredAi30d++;
        bump(s.starred_at);
      }
      if (isSeed) matched.add(`star-seed:${s.repo.full_name}`);
      if (starredAiSample.length < 12) {
        starredAiSample.push({
          full_name: s.repo.full_name,
          description: s.repo.description,
          starred_at: s.starred_at ?? null,
          html_url: s.repo.html_url,
        });
      }
    }
  }

  const ACTIVE = new Set([
    "PushEvent",
    "PullRequestEvent",
    "CreateEvent",
    "WatchEvent",
    "IssuesEvent",
    "PullRequestReviewEvent",
    "ForkEvent",
  ]);
  for (const e of events) {
    const repoName = (e.repo?.name ?? "").toLowerCase();
    const isSeed = SEED_SET.has(repoName);
    if (ACTIVE.has(e.type) && (isSeed || repoLooksAI(repoName, null))) {
      matched.add(`${e.type}:${e.repo.name}`);
      if (isSeed && (e.type === "PushEvent" || e.type === "PullRequestEvent")) {
        contributed.add(e.repo.name);
      }
      bump(e.created_at);
    }
  }

  return {
    relevant: matched.size > 0 || starredAiCount > 0,
    matched: [...matched].slice(0, 30),
    contributed: [...contributed],
    starredAiCount,
    starredAi30d,
    starredAiSample,
    lastAiActivity: lastAi ? new Date(lastAi).toISOString() : null,
  };
}

async function buildPool(): Promise<{ login: string; bucket: string }[]> {
  const seen = new Set<string>();
  // One list per (city x follower-bucket) query series.
  const lists: { weight: number; items: { login: string; bucket: string }[] }[] = [];
  for (const loc of LOCATION_QUERIES) {
    const locQuery = loc.query.includes(" ") ? `"${loc.query}"` : loc.query;
    // London is the point of the tool, so it gets proportionally more pages.
    const pages = Math.max(1, Math.round(PAGES_PER_QUERY * (loc.weight ?? 1)));
    for (const fb of FOLLOWER_BUCKETS) {
      const q = `location:${locQuery} followers:${fb} repos:>1`;
      const list: { login: string; bucket: string }[] = [];
      for (let page = 1; page <= pages; page++) {
        let items;
        try {
          ({ items } = await searchUsers(q, page));
        } catch (e) {
          console.error(`[search] ${loc.query} f:${fb} p${page}: ${(e as Error).message}`);
          break;
        }
        if (!items.length) break;
        for (const it of items) {
          if (!seen.has(it.login)) {
            seen.add(it.login);
            list.push({ login: it.login, bucket: loc.bucket });
          }
        }
        if (items.length < 100) break; // last page of this bucket
      }
      if (list.length) lists.push({ weight: loc.weight ?? 1, items: list });
      console.log(`[search] ${loc.query} f:${fb}: ${list.length} new (pool ${seen.size})`);
    }
  }
  // Weighted round-robin across all (city x bucket) lists, so scanning samples
  // every city AND every follower band rather than draining one of either.
  //
  // The weight has to be applied HERE, not just to how many pages we fetch. An
  // earlier version weighted only the fetch and then interleaved one-per-list,
  // which handed every city an equal share of the scan budget: a London-focused
  // radar came back with 25 Londoners out of 300, behind Bristol and Oxford.
  const pool: { login: string; bucket: string }[] = [];
  const cursors = lists.map(() => 0);
  for (;;) {
    let progressed = false;
    for (const [li, list] of lists.entries()) {
      // Take `weight` entries per cycle instead of one.
      for (let k = 0; k < list.weight; k++) {
        const i = cursors[li];
        if (i >= list.items.length) break;
        pool.push(list.items[i]);
        cursors[li] = i + 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return pool;
}

async function main() {
  console.log(`[ingest] store=${await backend()}`);
  console.log(
    `[ingest] target=${TARGET} maxScan=${MAX_SCAN} pagesPerQuery=${PAGES_PER_QUERY} buckets=[${FOLLOWER_BUCKETS.join(", ")}]`,
  );

  const pool = await buildPool();
  console.log(`[ingest] candidate pool: ${pool.length} unique logins`);

  let kept = 0;
  let scanned = 0;
  for (const p of pool) {
    if (kept >= TARGET || scanned >= MAX_SCAN) break;
    scanned++;
    try {
      const user: GhUser = await getUser(p.login);
      const [repos, starred, events] = await Promise.all([
        getUserRepos(p.login),
        getUserStarred(p.login),
        getUserEvents(p.login),
      ]);

      const ev = evaluate(repos, starred, events);
      if (!ev.relevant) continue;
      // Country-level searches ("United Kingdom", "England") pull in profiles
      // whose self-written location is somewhere else entirely.
      if (!looksUK(user.location)) continue;

      const topRepos = repos
        .filter((r) => !r.fork)
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 8)
        .map(toRepoSummary);

      const row = {
        github_login: user.login,
        github_id: user.id,
        name: user.name,
        bio: user.bio,
        company: user.company,
        email: user.email,
        blog: user.blog || null,
        twitter_username: user.twitter_username,
        avatar_url: user.avatar_url,
        html_url: user.html_url,
        hireable: user.hireable,
        location: user.location,
        location_normalized: normalizeLocation(user.location, p.bucket),
        followers: user.followers,
        following: user.following,
        public_repos: user.public_repos,
        account_created_at: user.created_at,
        github_updated_at: user.updated_at,
        top_repos: topRepos,
        starred_ai_sample: ev.starredAiSample,
        starred_ai_count: ev.starredAiCount,
        starred_ai_30d: ev.starredAi30d,
        contributed_ai_repos: ev.contributed,
        matched_signals: ev.matched,
        last_ai_activity_at: ev.lastAiActivity,
      };

      await upsertCandidates([row]);
      kept++;
      if (kept % 10 === 0) {
        console.log(`[ingest] kept ${kept}/${TARGET} (scanned ${scanned}/${pool.length})`);
      }
    } catch (e) {
      console.error(`[skip] ${p.login}: ${(e as Error).message}`);
    }
    await sleep(40); // gentle pacing to avoid secondary limits
  }

  console.log(`[ingest] DONE — kept ${kept} candidates (scanned ${scanned}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
