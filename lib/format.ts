export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function relativeDays(iso: string | null): string {
  const d = daysSince(iso);
  if (d === null) return "—";
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function accountAgeYears(iso: string | null): string {
  const d = daysSince(iso);
  if (d === null) return "?";
  return (d / 365).toFixed(1);
}

// Tailwind classes for a fit-score badge.
export function scoreClasses(score: number | null): string {
  if (score === null) return "bg-zinc-100 text-zinc-400 border-zinc-200";
  if (score >= 8) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 6) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-500 border-zinc-200";
}
