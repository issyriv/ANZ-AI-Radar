import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Company } from "@/lib/types";
import CompaniesTable from "./CompaniesTable";

export const dynamic = "force-dynamic";

async function loadCompanies(): Promise<{ companies: Company[]; error: string | null }> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("companies")
      .select("*")
      .order("thesis_fit_score", { ascending: false, nullsFirst: false })
      .order("source_published_at", { ascending: false, nullsFirst: false });
    if (error) return { companies: [], error: error.message };
    return { companies: (data ?? []) as Company[], error: null };
  } catch (e) {
    return { companies: [], error: (e as Error).message };
  }
}

export default async function Home() {
  const { companies, error } = await loadCompanies();
  const aiCount = companies.filter((c) => c.ai_native).length;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <header className="mb-6">
        <nav className="mb-3 flex gap-4 text-sm">
          <span className="font-medium text-zinc-900">Deal Flow</span>
          <Link href="/candidates" className="text-zinc-500 hover:text-zinc-900">Talent Radar</Link>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">ANZ AI Radar</h1>
            <p className="mt-1 text-sm text-zinc-500">
              ANZ startup raises, aggregated from the news feeds and scored against Airtree&apos;s AI durability thesis.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <span className="font-semibold text-zinc-900">{companies.length}</span> companies ·{" "}
            <span className="font-semibold text-zinc-900">{aiCount}</span> AI-native
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-zinc-500">Couldn&apos;t load companies. Apply the schema and run the pipeline:</p>
          <pre className="mt-3 rounded-lg bg-zinc-900 p-4 text-xs text-zinc-100">{`npm run deals   # pull + score this week's ANZ raises`}</pre>
          <p className="mt-3 text-xs text-red-600">{error}</p>
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          No companies yet. Run <code className="rounded bg-zinc-100 px-1">npm run deals</code>.
        </div>
      ) : (
        <CompaniesTable companies={companies} />
      )}
    </main>
  );
}
