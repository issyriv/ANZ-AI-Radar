import Link from "next/link";
import { loadSourceRuns } from "@/lib/store";
import { FUND, FUND_PORTFOLIO, FUND_PORTFOLIO_SYNCED_AT, FUND_UK_PORTFOLIO } from "@/lib/fund";
import { FEEDS, PORTFOLIOS } from "@/lib/sources";
import type { SourceRun } from "@/lib/types";
import { relativeDays } from "@/lib/format";

export const dynamic = "force-dynamic";

// The crawl touches ~70 sources, and sources rot silently — a site redesign
// turns a working scraper into one that returns zero rows without erroring.
// This page is the audit trail: what ran, how it was fetched, what it yielded.
export default async function SourcesPage() {
  let runs: SourceRun[] = [];
  let error: string | null = null;
  try {
    runs = await loadSourceRuns();
  } catch (e) {
    error = (e as Error).message;
  }

  // Only show the most recent run of each source.
  const latest = new Map<string, SourceRun>();
  for (const r of [...runs].sort(
    (a, b) => Date.parse(a.created_at ?? "0") - Date.parse(b.created_at ?? "0"),
  )) {
    latest.set(r.source, r);
  }
  const rows = [...latest.values()].sort(
    (a, b) => b.companies_stored - a.companies_stored || a.source.localeCompare(b.source),
  );

  const ok = rows.filter((r) => r.ok).length;
  const headless = rows.filter((r) => r.via === "headless").length;
  const totalCompanies = rows.reduce((n, r) => n + r.companies_stored, 0);
  const registered = FEEDS.length + PORTFOLIOS.length + 2;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <header className="mb-6">
        <nav className="mb-3 flex gap-4 text-sm">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">Deal Flow</Link>
          <Link href="/candidates" className="text-zinc-500 hover:text-zinc-900">Talent Radar</Link>
          <Link href="/formations" className="text-zinc-500 hover:text-zinc-900">Formations</Link>
          <span className="font-medium text-zinc-900">Sources</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Source health</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Every source in the registry, from the most recent crawl. Sources rot quietly, so
              this is the audit trail: how each one was fetched and what it actually contributed.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <div>
              <span className="font-semibold text-zinc-900">{ok}</span> of{" "}
              <span className="font-semibold text-zinc-900">{rows.length}</span> sources OK
            </div>
            <div>
              <span className="font-semibold text-zinc-900">{headless}</span> needed a headless browser
            </div>
            <div>
              <span className="font-semibold text-zinc-900">{registered}</span> registered ·{" "}
              <span className="font-semibold text-zinc-900">{totalCompanies}</span> rows this run
            </div>
          </div>
        </div>
      </header>

      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Fund profile
        </div>
        <p className="mt-2 text-zinc-700">
          Scored against <span className="font-medium">{FUND.name}</span> — {FUND.blurb}, investing
          out of {FUND.hq}. The alumni list used for overlap detection is scraped from
          {" "}{FUND.name}&apos;s own portfolio page:{" "}
          <span className="font-medium text-zinc-900">{FUND_PORTFOLIO.length}</span> companies,{" "}
          <span className="font-medium text-zinc-900">{FUND_UK_PORTFOLIO.length}</span> of them UK.
          Last synced {relativeDays(FUND_PORTFOLIO_SYNCED_AT)} (<code className="rounded bg-zinc-100 px-1 text-xs">npm run fund:sync</code>).
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No crawl recorded yet. Run <code className="rounded bg-zinc-100 px-1">npm run deals</code>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Fetched via</th>
                <th className="px-3 py-2.5 text-right font-medium">Found</th>
                <th className="px-3 py-2.5 text-right font-medium">Companies</th>
                <th className="px-3 py-2.5 text-right font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id ?? r.source} className="border-t border-zinc-100 align-top">
                  <td className="px-3 py-2.5">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                        {r.source}
                      </a>
                    ) : (
                      <span className="font-medium text-zinc-900">{r.source}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-600">
                    {(r.source_type ?? "—").replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2.5">
                    <ViaBadge via={r.via} mode={r.mode} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-600">
                    {r.items_found || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-medium tabular-nums text-zinc-900">
                    {r.companies_stored || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-500">
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.ok ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
                        ok
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200" title={r.error ?? ""}>
                        {r.error ? r.error.slice(0, 40) : "no content"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function ViaBadge({ via, mode }: { via: string | null; mode: string | null }) {
  const label = via ?? "—";
  const cls =
    via === "headless"
      ? "bg-violet-50 text-violet-700 ring-violet-200"
      : via === "cache"
        ? "bg-zinc-100 text-zinc-600 ring-zinc-200"
        : "bg-sky-50 text-sky-700 ring-sky-200";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>{label}</span>
      {mode === "auto" && via === "headless" && (
        <span className="text-[10px] text-zinc-400" title="Plain HTTP returned a thin page; fell back to the browser">
          fallback
        </span>
      )}
    </span>
  );
}
