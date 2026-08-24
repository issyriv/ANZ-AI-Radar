"use client";

import { useMemo, useState } from "react";
import type { Candidate, RepoSummary, StarredRepoSummary } from "@/lib/types";
import { daysSince, relativeDays, accountAgeYears, scoreClasses } from "@/lib/format";

type SortKey = "fit_score" | "name" | "location_normalized" | "last_ai_activity_at" | "starred_ai_30d";

const ACTIVITY_WINDOWS = [
  { label: "Any time", value: 0 },
  { label: "30 days", value: 30 },
  { label: "60 days", value: 60 },
  { label: "90 days", value: 90 },
];

export default function CandidateTable({ candidates }: { candidates: Candidate[] }) {
  const [minFit, setMinFit] = useState(0);
  const [location, setLocation] = useState("all");
  const [activity, setActivity] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("fit_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) if (c.location_normalized) set.add(c.location_normalized);
    return Array.from(set).sort();
  }, [candidates]);

  const presetActive = minFit === 7 && activity === 30;
  function applyPreset() {
    if (presetActive) {
      setMinFit(0);
      setActivity(0);
    } else {
      setMinFit(7);
      setActivity(30);
      setSortKey("fit_score");
      setSortDir("desc");
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "location_normalized" ? "asc" : "desc");
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = candidates.filter((c) => {
      if ((c.fit_score ?? 0) < minFit) return false;
      if (location !== "all" && c.location_normalized !== location) return false;
      if (activity > 0) {
        const d = daysSince(c.last_ai_activity_at);
        if (d === null || d > activity) return false;
      }
      if (q) {
        const hay = `${c.name ?? ""} ${c.github_login}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case "name":
          av = (a.name ?? a.github_login).toLowerCase();
          bv = (b.name ?? b.github_login).toLowerCase();
          break;
        case "location_normalized":
          av = a.location_normalized ?? "";
          bv = b.location_normalized ?? "";
          break;
        case "last_ai_activity_at":
          av = a.last_ai_activity_at ? Date.parse(a.last_ai_activity_at) : 0;
          bv = b.last_ai_activity_at ? Date.parse(b.last_ai_activity_at) : 0;
          break;
        case "starred_ai_30d":
          av = a.starred_ai_30d ?? 0;
          bv = b.starred_ai_30d ?? 0;
          break;
        default:
          av = a.fit_score ?? -1;
          bv = b.fit_score ?? -1;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [candidates, minFit, location, activity, search, sortKey, sortDir]);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={applyPreset}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            presetActive
              ? "border-emerald-300 bg-emerald-600 text-white"
              : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
          }`}
        >
          Founder signals · fit 7+ · active 30d
        </button>

        <div className="h-5 w-px bg-zinc-200" />

        <Select value={location} onChange={setLocation} label="Location">
          <option value="all">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>

        <Select
          value={String(minFit)}
          onChange={(v) => setMinFit(Number(v))}
          label="Min fit"
        >
          {[0, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Any fit" : `Fit ${n}+`}
            </option>
          ))}
        </Select>

        <Select
          value={String(activity)}
          onChange={(v) => setActivity(Number(v))}
          label="Activity"
        >
          {ACTIVITY_WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or username…"
          className="ml-auto w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {rows.length} of {candidates.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <Th onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>
                Builder
              </Th>
              <Th
                onClick={() => toggleSort("location_normalized")}
                active={sortKey === "location_normalized"}
                dir={sortDir}
              >
                Location
              </Th>
              <th className="px-3 py-2.5 font-medium">Why interesting</th>
              <Th
                onClick={() => toggleSort("fit_score")}
                active={sortKey === "fit_score"}
                dir={sortDir}
                className="w-16 text-center"
              >
                Fit
              </Th>
              <th className="px-3 py-2.5 font-medium">Signals</th>
              <Th
                onClick={() => toggleSort("starred_ai_30d")}
                active={sortKey === "starred_ai_30d"}
                dir={sortDir}
                className="w-20 text-center"
              >
                AI★ 30d
              </Th>
              <Th
                onClick={() => toggleSort("last_ai_activity_at")}
                active={sortKey === "last_ai_activity_at"}
                dir={sortDir}
                className="w-28"
              >
                Last AI act.
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isOpen = expanded === c.id;
              const alumni = c.fund_alumni_match ?? [];
              const signals = c.signals ?? [];
              return (
                <FragmentRow
                  key={c.id}
                  c={c}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : c.id)}
                  alumni={alumni}
                  signals={signals}
                />
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">
                  No candidates match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  c,
  isOpen,
  onToggle,
  alumni,
  signals,
}: {
  c: Candidate;
  isOpen: boolean;
  onToggle: () => void;
  alumni: string[];
  signals: string[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-t border-zinc-100 align-top transition-colors hover:bg-zinc-50 ${
          isOpen ? "bg-zinc-50" : ""
        }`}
      >
        <td className="px-3 py-3">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.avatar_url ?? ""} alt="" className="h-7 w-7 rounded-full bg-zinc-100" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-zinc-900">{c.name ?? c.github_login}</span>
                {alumni.map((a) => (
                  <span
                    key={a}
                    className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200"
                  >
                    ex-{a}
                  </span>
                ))}
              </div>
              <a
                href={c.html_url ?? "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline"
              >
                @{c.github_login}
              </a>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-xs text-zinc-600">{c.location_normalized ?? "—"}</td>
        <td className="max-w-md px-3 py-3 text-xs leading-relaxed text-zinc-600">
          <span className="line-clamp-2">{c.enrichment_summary ?? "—"}</span>
        </td>
        <td className="px-3 py-3 text-center">
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-sm font-semibold ${scoreClasses(
              c.fit_score,
            )}`}
          >
            {c.fit_score ?? "–"}
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex max-w-xs flex-wrap gap-1">
            {signals.slice(0, 2).map((s, i) => (
              <span
                key={i}
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600"
              >
                {s}
              </span>
            ))}
            {signals.length > 2 && (
              <span className="text-[10px] text-zinc-400">+{signals.length - 2}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-center text-xs">
          {c.starred_ai_30d > 0 ? (
            <span className="font-semibold text-emerald-700">{c.starred_ai_30d}</span>
          ) : (
            <span className="text-zinc-300">0</span>
          )}
        </td>
        <td className="px-3 py-3 text-xs text-zinc-600">{relativeDays(c.last_ai_activity_at)}</td>
      </tr>
      {isOpen && (
        <tr className="border-t border-zinc-100 bg-zinc-50/60">
          <td colSpan={7} className="px-4 py-5">
            <ExpandedDetail c={c} signals={signals} alumni={alumni} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({
  c,
  signals,
  alumni,
}: {
  c: Candidate;
  signals: string[];
  alumni: string[];
}) {
  const repos = (c.top_repos as RepoSummary[]) ?? [];
  const stars = (c.starred_ai_sample as StarredRepoSummary[]) ?? [];
  const contributed = c.contributed_ai_repos ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left: assessment */}
      <div className="lg:col-span-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Assessment</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-800">{c.enrichment_summary ?? "—"}</p>

        {alumni.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {alumni.map((a) => (
              <span
                key={a}
                className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200"
              >
                ex-{a}
              </span>
            ))}
          </div>
        )}

        {signals.length > 0 && (
          <ul className="mt-3 space-y-1">
            {signals.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-700">
                <span className="text-emerald-500">▸</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <Stat label="Followers" value={c.followers} />
          <Stat label="Public repos" value={c.public_repos} />
          <Stat label="Acct age" value={`${accountAgeYears(c.account_created_at)}y`} />
          <Stat label="AI stars" value={c.starred_ai_count} />
          <Stat label="AI★ 30d" value={c.starred_ai_30d} />
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <a
            href={c.html_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-zinc-900 underline-offset-2 hover:underline"
          >
            GitHub ↗
          </a>
          {c.blog && (
            <a
              href={c.blog.startsWith("http") ? c.blog : `https://${c.blog}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-600 underline-offset-2 hover:underline"
            >
              Website ↗
            </a>
          )}
          {c.twitter_username && (
            <a
              href={`https://x.com/${c.twitter_username}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-600 underline-offset-2 hover:underline"
            >
              @{c.twitter_username} ↗
            </a>
          )}
        </div>
        {contributed.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            <span className="font-medium text-zinc-700">Contributes to:</span>{" "}
            {contributed.join(", ")}
          </p>
        )}
      </div>

      {/* Middle: owned repos */}
      <div className="lg:col-span-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Top owned repos
        </div>
        <ul className="mt-2 space-y-2">
          {repos.length === 0 && <li className="text-xs text-zinc-400">none</li>}
          {repos.slice(0, 6).map((r) => (
            <li key={r.name} className="text-xs">
              <a
                href={r.html_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-zinc-900 hover:underline"
              >
                {r.name}
              </a>
              <span className="text-zinc-400">
                {" "}
                · {r.language ?? "?"} · {r.stars}★
              </span>
              {r.description && <p className="text-zinc-500">{r.description}</p>}
            </li>
          ))}
        </ul>
      </div>

      {/* Right: starred AI */}
      <div className="lg:col-span-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Recently starred AI repos
        </div>
        <ul className="mt-2 space-y-2">
          {stars.length === 0 && <li className="text-xs text-zinc-400">none</li>}
          {stars.slice(0, 8).map((s) => (
            <li key={s.full_name} className="text-xs">
              <a
                href={s.html_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-zinc-900 hover:underline"
              >
                {s.full_name}
              </a>
              {s.starred_at && (
                <span className="text-zinc-400"> · {s.starred_at.slice(0, 10)}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <span className="font-semibold text-zinc-700">{value}</span> {label}
    </span>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-500">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-900"
      >
        {children}
      </select>
    </label>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2.5 font-medium hover:text-zinc-900 ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-zinc-400">{dir === "desc" ? "↓" : "↑"}</span>}
      </span>
    </th>
  );
}
