import Link from "next/link";
import { loadFormations, type ScoredFormation } from "@/lib/formations-store";
import { relativeDays } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function FormationsPage() {
  const { formations, generatedAt, triaged } = loadFormations();

  const anchored = formations.filter((f) => f.matched_candidate).length;
  const raised = formations.filter((f) => f.has_share_allotment).length;
  const reachOut = formations.filter((f) => f.triage?.recommended_action === "reach out").length;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <header className="mb-6">
        <nav className="mb-3 flex gap-4 text-sm">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">Deal Flow</Link>
          <Link href="/candidates" className="text-zinc-500 hover:text-zinc-900">Talent Radar</Link>
          <span className="font-medium text-zinc-900">Formations</span>
          <Link href="/sources" className="text-zinc-500 hover:text-zinc-900">Sources</Link>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Formations</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              Newly incorporated UK companies from the Companies House register that have{" "}
              <span className="font-medium text-zinc-700">not</span> appeared in any portfolio page,
              feed or directory. This is the only source here that can see a company before someone
              announces it.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <div><span className="font-semibold text-zinc-900">{formations.length}</span> formations</div>
            <div><span className="font-semibold text-zinc-900">{anchored}</span> person-anchored</div>
            <div><span className="font-semibold text-zinc-900">{raised}</span> filed a share allotment</div>
            {triaged && <div><span className="font-semibold text-emerald-700">{reachOut}</span> marked reach out</div>}
          </div>
        </div>
      </header>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <span className="font-semibold">Read these differently to the deal flow.</span> A company
        incorporated a few months ago has no public product, customers or revenue, so it is not
        scored on the durability thesis — that would mean inventing facts. What is shown is what the
        register and the talent radar actually support: who the directors are, whether one of them
        is a builder we already track, whether shares have been allotted, and a triage read with an
        explicit confidence. Low confidence is the honest default here.
      </div>

      {formations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No scan yet. Set <code className="rounded bg-zinc-100 px-1">COMPANIES_HOUSE_API_KEY</code>{" "}
          (a <span className="font-medium">live</span> key, not a sandbox one) and run{" "}
          <code className="rounded bg-zinc-100 px-1">npm run formations</code>.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {formations.map((f) => (
              <FormationCard key={f.company_number} f={f} />
            ))}
          </div>
          {generatedAt && (
            <p className="mt-6 text-xs text-zinc-400">
              Scan generated {relativeDays(generatedAt)}
              {!triaged && " · triage pass not yet run (npm run formations:score)"}
            </p>
          )}
        </>
      )}
    </main>
  );
}

function FormationCard({ f }: { f: ScoredFormation }) {
  const action = f.triage?.recommended_action;
  const actionCls =
    action === "reach out"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : action === "watch"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://find-and-update.company-information.service.gov.uk/company/${f.company_number}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {f.company_name}
            </a>
            {f.matched_candidate && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-200">
                radar director
              </span>
            )}
            {f.has_share_allotment && (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
                SH01
              </span>
            )}
            {action && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${actionCls}`}>
                {action}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {f.company_number} · incorporated {f.incorporated_on} ({f.months_old} months ago)
            {f.hq_city ? ` · ${f.hq_city}` : ""}
            {f.sic_codes.length ? ` · SIC ${f.sic_codes.join(", ")}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          {f.triage && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">venture</div>
              <div className="text-sm font-semibold text-zinc-900">{f.triage.venture_likelihood}/10</div>
              <div className="text-[10px] text-zinc-400">conf {f.triage.confidence}</div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-400">signal</div>
            <div className="text-sm font-semibold text-zinc-900">{f.score}</div>
          </div>
        </div>
      </div>

      {f.triage && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <div className="text-sm text-zinc-800">{f.triage.likely_focus}</div>
          <div className="mt-1 text-xs text-zinc-600">{f.triage.why_interesting}</div>
        </div>
      )}

      <div className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 text-xs sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Directors</div>
          <div className="mt-0.5 text-zinc-700">
            {f.officers.length ? f.officers.map(titleCase).join(", ") : "none listed"}
          </div>
          {f.matched_candidate && (
            <a
              href={`https://github.com/${f.matched_candidate}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-block text-zinc-500 underline-offset-2 hover:underline"
            >
              github.com/{f.matched_candidate} ↗
            </a>
          )}
          {f.prior_companies.length > 0 && (
            <div className="mt-1 text-zinc-500">
              <span className="font-medium text-zinc-600">Prior directorships:</span>{" "}
              {f.prior_companies.slice(0, 4).join(", ")}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Why it surfaced</div>
          <ul className="mt-0.5 space-y-0.5 text-zinc-600">
            {f.signals.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
