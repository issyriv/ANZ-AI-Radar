import "./_bootstrap";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Candidate, Snapshot, SnapshotRow } from "../lib/types";

// Usage:
//   npm run snapshot          -> save a snapshot of the current candidate list
//   npm run snapshot -- diff  -> diff the two most recent snapshots (movers)
const MODE = process.argv.includes("diff") ? "diff" : "save";

async function save() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("candidates")
    .select(
      "github_login, fit_score, last_ai_activity_at, starred_ai_count, starred_ai_30d, followers, public_repos",
    );
  if (error) throw new Error(error.message);

  const rows: SnapshotRow[] = (data ?? []).map((c) => ({
    login: c.github_login,
    fit_score: c.fit_score,
    last_ai_activity_at: c.last_ai_activity_at,
    starred_ai_count: c.starred_ai_count ?? 0,
    starred_ai_30d: c.starred_ai_30d ?? 0,
    followers: c.followers ?? 0,
    public_repos: c.public_repos ?? 0,
  }));

  const { error: insErr } = await sb.from("snapshots").insert({
    label: `auto ${new Date().toISOString().slice(0, 16)}`,
    candidate_count: rows.length,
    data: rows,
  });
  if (insErr) throw new Error(insErr.message);
  console.log(`[snapshot] saved ${rows.length} candidates.`);
}

async function diff() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) throw new Error(error.message);
  const snaps = (data ?? []) as Snapshot[];
  if (snaps.length < 2) {
    console.log(`[diff] need 2 snapshots, have ${snaps.length}. Take another later, then diff.`);
    return;
  }

  const [curr, prev] = snaps;
  console.log(`[diff] ${prev.created_at} -> ${curr.created_at}`);
  const prevMap = new Map(prev.data.map((r) => [r.login, r]));

  type Mover = { login: string; reason: string; score: number };
  const movers: Mover[] = [];

  for (const r of curr.data) {
    const p = prevMap.get(r.login);
    if (!p) {
      movers.push({ login: r.login, reason: "NEW candidate", score: 100 });
      continue;
    }
    const reasons: string[] = [];
    let score = 0;
    const starDelta = r.starred_ai_count - p.starred_ai_count;
    if (starDelta > 0) {
      reasons.push(`+${starDelta} AI stars`);
      score += starDelta * 3;
    }
    if (r.starred_ai_30d > p.starred_ai_30d) {
      reasons.push(`30d AI starring ${p.starred_ai_30d}->${r.starred_ai_30d}`);
      score += (r.starred_ai_30d - p.starred_ai_30d) * 4;
    }
    if ((r.fit_score ?? 0) > (p.fit_score ?? 0)) {
      reasons.push(`fit ${p.fit_score}->${r.fit_score}`);
      score += ((r.fit_score ?? 0) - (p.fit_score ?? 0)) * 5;
    }
    if (
      r.last_ai_activity_at &&
      (!p.last_ai_activity_at || Date.parse(r.last_ai_activity_at) > Date.parse(p.last_ai_activity_at))
    ) {
      reasons.push(`fresh AI activity ${r.last_ai_activity_at.slice(0, 10)}`);
      score += 5;
    }
    if (reasons.length) movers.push({ login: r.login, reason: reasons.join(", "), score });
  }

  movers.sort((a, b) => b.score - a.score);
  console.log(`[diff] ${movers.length} movers since last snapshot:\n`);
  for (const m of movers.slice(0, 25)) {
    console.log(`  ${m.login.padEnd(24)} ${m.reason}`);
  }
}

(MODE === "diff" ? diff() : save())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
