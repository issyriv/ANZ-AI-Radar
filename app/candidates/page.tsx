import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Candidate } from "@/lib/types";
import CandidateTable from "../CandidateTable";

export const dynamic = "force-dynamic";

async function loadCandidates(): Promise<{ candidates: Candidate[]; error: string | null }> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("candidates")
      .select("*")
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("starred_ai_30d", { ascending: false });
    if (error) return { candidates: [], error: error.message };
    return { candidates: (data ?? []) as Candidate[], error: null };
  } catch (e) {
    return { candidates: [], error: (e as Error).message };
  }
}

export default async function CandidatesPage() {
  const { candidates, error } = await loadCandidates();
  const enrichedCount = candidates.filter((c) => c.fit_score !== null).length;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <header className="mb-6">
        <nav className="mb-3 flex gap-4 text-sm">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">Deal Flow</Link>
          <span className="font-medium text-zinc-900">Talent Radar</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Talent Radar</h1>
            <p className="mt-1 text-sm text-zinc-500">
              AI-active builders across Australia &amp; New Zealand, surfaced from GitHub and ranked by founder-fit.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <span className="font-semibold text-zinc-900">{candidates.length}</span> people ·{" "}
            <span className="font-semibold text-zinc-900">{enrichedCount}</span> enriched
          </div>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No candidates yet. Run <code className="rounded bg-zinc-100 px-1">npm run ingest</code> then{" "}
          <code className="rounded bg-zinc-100 px-1">npm run enrich</code>.
        </div>
      ) : (
        <CandidateTable candidates={candidates} />
      )}
    </main>
  );
}
