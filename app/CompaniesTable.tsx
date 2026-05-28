"use client";

import { useMemo, useState } from "react";
import type { Company, ThesisBreakdown } from "@/lib/types";
import { relativeDays, daysSince, scoreClasses } from "@/lib/format";
import { DURABILITY_QUESTIONS } from "@/lib/thesis";

type SortKey = "thesis_fit_score" | "name" | "source_published_at";

export default function CompaniesTable({ companies }: { companies: Company[] }) {
  const [minFit, setMinFit] = useState(0);
  const [sector, setSector] = useState("all");
  const [stage, setStage] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [aiOnly, setAiOnly] = useState(false);
  const [recency, setRecency] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("thesis_fit_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sectors = useMemo(
    () => Array.from(new Set(companies.map((c) => c.sector).filter(Boolean))).sort() as string[],
    [companies],
  );
  const stages = useMemo(
    () => Array.from(new Set(companies.map((c) => c.stage).filter(Boolean))).sort() as string[],
    [companies],
  );
  const sourceTypes = useMemo(
    () => Array.from(new Set(companies.map((c) => c.source_type).filter(Boolean))).sort() as string[],
    [companies],
  );

  const presetActive = minFit === 7 && aiOnly;
  function applyPreset() {
    if (presetActive) {
      setMinFit(0);
      setAiOnly(false);
    } else {
      setMinFit(7);
      setAiOnly(true);
      setSortKey("thesis_fit_score");
      setSortDir("desc");
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const rows = useMemo(() => {
    let list = companies.filter((c) => {
      if ((c.thesis_fit_score ?? 0) < minFit) return false;
      if (sector !== "all" && c.sector !== sector) return false;
      if (stage !== "all" && c.stage !== stage) return false;
      if (sourceType !== "all" && c.source_type !== sourceType) return false;
      if (aiOnly && !c.ai_native) return false;
      if (recency > 0) {
        const d = daysSince(c.source_published_at);
        if (d === null || d > recency) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortKey === "source_published_at") {
        av = a.source_published_at ? Date.parse(a.source_published_at) : 0;
        bv = b.source_published_at ? Date.parse(b.source_published_at) : 0;
      } else {
        av = a.thesis_fit_score ?? -1;
        bv = b.thesis_fit_score ?? -1;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [companies, minFit, sector, stage, sourceType, aiOnly, recency, sortKey, sortDir]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={applyPreset}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            presetActive
              ? "border-emerald-300 bg-emerald-600 text-white"
              : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
          }`}
        >
          Thesis picks · AI-native · fit 7+
        </button>
        <div className="h-5 w-px bg-zinc-200" />
        <Select value={sector} onChange={setSector}>
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={stage} onChange={setStage}>
          <option value="all">All stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={sourceType} onChange={setSourceType}>
          <option value="all">All source types</option>
          {sourceTypes.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </Select>
        <Select value={String(minFit)} onChange={(v) => setMinFit(Number(v))}>
          {[0, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n === 0 ? "Any fit" : `Fit ${n}+`}</option>
          ))}
        </Select>
        <Select value={String(recency)} onChange={(v) => setRecency(Number(v))}>
          <option value={0}>Any time</option>
          <option value={30}>Last 30d</option>
          <option value={90}>Last 90d</option>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} />
          AI-native only
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {rows.length} of {companies.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <Th onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>Company</Th>
              <th className="px-3 py-2.5 font-medium">Sector</th>
              <th className="px-3 py-2.5 font-medium">Stage</th>
              <th className="px-3 py-2.5 font-medium">Raised</th>
              <Th onClick={() => toggleSort("thesis_fit_score")} active={sortKey === "thesis_fit_score"} dir={sortDir} className="w-20 text-center">Thesis</Th>
              <th className="px-3 py-2.5 font-medium">Airtree</th>
              <Th onClick={() => toggleSort("source_published_at")} active={sortKey === "source_published_at"} dir={sortDir} className="w-28">Source</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <CompanyRow key={c.id} c={c} open={expanded === c.id} onToggle={() => setExpanded(expanded === c.id ? null : c.id)} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">No companies match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyRow({ c, open, onToggle }: { c: Company; open: boolean; onToggle: () => void }) {
  const overlap = c.airtree_overlap ?? [];
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer border-t border-zinc-100 align-top transition-colors hover:bg-zinc-50 ${open ? "bg-zinc-50" : ""}`}>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-900">{c.name}</span>
            {c.ai_native && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-200">AI</span>}
          </div>
          {c.summary && <span className="mt-0.5 line-clamp-1 block max-w-md text-xs text-zinc-500">{c.summary}</span>}
        </td>
        <td className="px-3 py-3 text-xs text-zinc-600">{c.sector ?? "—"}</td>
        <td className="px-3 py-3 text-xs text-zinc-600">{c.stage ?? "—"}</td>
        <td className="px-3 py-3 text-xs text-zinc-600">{c.amount_raised ?? "—"}</td>
        <td className="px-3 py-3 text-center">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-sm font-semibold ${scoreClasses(c.thesis_fit_score)}`}>
            {c.thesis_fit_score ?? "–"}
          </span>
        </td>
        <td className="px-3 py-3">
          {overlap.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {overlap.map((a) => (
                <span key={a} className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">{a}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-zinc-300">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-xs text-zinc-600">
          {c.source ?? "—"}
          <span className="block text-zinc-400">{relativeDays(c.source_published_at)}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-100 bg-zinc-50/60">
          <td colSpan={7} className="px-4 py-5">
            <CompanyDetail c={c} />
          </td>
        </tr>
      )}
    </>
  );
}

function CompanyDetail({ c }: { c: Company }) {
  const b = c.thesis_breakdown as ThesisBreakdown | null;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Why it fits</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-800">{c.summary ?? "—"}</p>
        <div className="mt-3 space-y-1 text-xs text-zinc-600">
          {c.founders?.length > 0 && <div><span className="font-medium text-zinc-700">Founders:</span> {c.founders.join(", ")}</div>}
          {c.investors?.length > 0 && <div><span className="font-medium text-zinc-700">Investors:</span> {c.investors.join(", ")}</div>}
          {c.amount_raised && <div><span className="font-medium text-zinc-700">Raised:</span> {c.amount_raised}</div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {c.website && <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 underline-offset-2 hover:underline">Website ↗</a>}
          {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer" className="text-zinc-600 underline-offset-2 hover:underline">{c.source ?? "Source"} ↗</a>}
        </div>
      </div>
      <div className="lg:col-span-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Durability breakdown</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {DURABILITY_QUESTIONS.map((q) => {
            const dim = b?.[q.key];
            return (
              <div key={q.key} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">{q.label}</span>
                  <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded border px-1 text-xs font-semibold ${scoreClasses(dim?.score ?? null)}`}>
                    {dim?.score ?? "–"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{dim?.note ?? "—"}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-900">
      {children}
    </select>
  );
}

function Th({ children, onClick, active, dir, className = "" }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc"; className?: string }) {
  return (
    <th onClick={onClick} className={`cursor-pointer select-none px-3 py-2.5 font-medium hover:text-zinc-900 ${className}`}>
      <span className="inline-flex items-center gap-1">{children}{active && <span className="text-zinc-400">{dir === "desc" ? "↓" : "↑"}</span>}</span>
    </th>
  );
}
