// Storage layer.
//
// Supabase is the intended backend, but the pipeline must not be unrunnable
// just because a hosted project is paused, deleted or unreachable — which is
// exactly what happened to the original project. So the store probes Supabase
// once at startup and transparently falls back to a local JSON store under
// .data/ when it cannot be reached.
//
// Both backends expose the same small surface. Everything the app and the
// scripts need goes through here; nothing else imports the Supabase client.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import type { Candidate, Company, SourceRun, Snapshot } from "./types";

const DATA_DIR = process.env.LOCAL_DATA_DIR ?? ".data";
const FORCE_LOCAL = process.env.STORE_BACKEND === "local";
const FORCE_SUPABASE = process.env.STORE_BACKEND === "supabase";

export type Backend = "supabase" | "local";

let _backend: Backend | null = null;
let _probe: Promise<Backend> | null = null;

/** Which backend is in use. Probes Supabase once, then caches the answer. */
export async function backend(): Promise<Backend> {
  if (_backend) return _backend;
  if (_probe) return _probe;
  _probe = (async () => {
    if (FORCE_LOCAL) return (_backend = "local");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key || url.includes("TODO") || key.includes("TODO")) {
      if (FORCE_SUPABASE) throw new Error("STORE_BACKEND=supabase but SUPABASE_URL/SECRET_KEY are not set");
      console.warn("[store] Supabase env not configured -> local store (.data/)");
      return (_backend = "local");
    }
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return (_backend = "supabase");
    } catch (e) {
      if (FORCE_SUPABASE) throw new Error(`Supabase unreachable: ${(e as Error).message}`);
      console.warn(
        `[store] Supabase unreachable (${(e as Error).message}) -> local store (.data/). ` +
          `Set SUPABASE_URL/SUPABASE_SECRET_KEY to a live project to use Supabase.`,
      );
      return (_backend = "local");
    }
  })();
  return _probe;
}

// --- local JSON tables ------------------------------------------------------
// Small datasets (low thousands of rows), so a whole-file read/write per commit
// is fine and keeps the data trivially inspectable. Writes go via a temp file
// and a rename so an interrupted run cannot leave a truncated table behind.

function tablePath(table: string): string {
  return join(DATA_DIR, `${table}.json`);
}

function readTable<T>(table: string): T[] {
  const p = tablePath(table);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T[];
  } catch {
    return [];
  }
}

function writeTable<T>(table: string, rows: T[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const p = tablePath(table);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2));
  renameSync(tmp, p);
}

function uuid(): string {
  return crypto.randomUUID();
}

// --- generic upsert ---------------------------------------------------------

async function sb() {
  const { getSupabaseAdmin } = await import("./supabase");
  return getSupabaseAdmin();
}

/**
 * Upsert `rows` into `table`, conflicting on `key`. Returns the number stored.
 * Errors are reported per row rather than aborting the batch, because one bad
 * extraction should never lose the rest of a crawl.
 */
export async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  key: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  if ((await backend()) === "supabase") {
    const client = await sb();
    let stored = 0;
    for (const row of rows) {
      const { error } = await client.from(table).upsert(row, { onConflict: key });
      if (error) console.error(`[store] upsert ${table} ${String(row[key])}: ${error.message}`);
      else stored++;
    }
    return stored;
  }

  const existing = readTable<Record<string, unknown>>(table);
  const byKey = new Map(existing.map((r) => [String(r[key]), r]));
  const now = new Date().toISOString();
  for (const row of rows) {
    const k = String(row[key]);
    const prev = byKey.get(k);
    byKey.set(k, {
      ...(prev ?? { id: uuid(), created_at: now }),
      ...row,
      updated_at: now,
    });
  }
  writeTable(table, [...byKey.values()]);
  return rows.length;
}

/** Insert rows with no conflict key (append-only tables). */
export async function insert(table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  if ((await backend()) === "supabase") {
    const client = await sb();
    const { error } = await client.from(table).insert(rows);
    if (error) {
      console.error(`[store] insert ${table}: ${error.message}`);
      return 0;
    }
    return rows.length;
  }
  const existing = readTable<Record<string, unknown>>(table);
  const now = new Date().toISOString();
  writeTable(table, [...existing, ...rows.map((r) => ({ id: uuid(), created_at: now, ...r }))]);
  return rows.length;
}

/** Update rows matching `where` (equality on a single column). */
export async function update(
  table: string,
  where: { column: string; value: unknown },
  patch: Record<string, unknown>,
): Promise<void> {
  if ((await backend()) === "supabase") {
    const client = await sb();
    const { error } = await client.from(table).update(patch).eq(where.column, where.value);
    if (error) throw new Error(error.message);
    return;
  }
  const rows = readTable<Record<string, unknown>>(table);
  const now = new Date().toISOString();
  let touched = false;
  for (const r of rows) {
    if (r[where.column] === where.value) {
      Object.assign(r, patch, { updated_at: now });
      touched = true;
    }
  }
  if (touched) writeTable(table, rows);
}

/** Read a whole table. Small enough that we never need server-side paging. */
export async function selectAll<T>(table: string): Promise<T[]> {
  if ((await backend()) === "supabase") {
    const client = await sb();
    const { data, error } = await client.from(table).select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  }
  return readTable<T>(table);
}

// --- typed helpers ----------------------------------------------------------

export const loadCompanies = () => selectAll<Company>("companies");
export const loadCandidates = () => selectAll<Candidate>("candidates");
export const loadSourceRuns = () => selectAll<SourceRun>("source_runs");
export const loadSnapshots = () => selectAll<Snapshot>("snapshots");

export const upsertCompanies = (rows: Record<string, unknown>[]) =>
  upsert("companies", rows, "name_normalized");
export const upsertCandidates = (rows: Record<string, unknown>[]) =>
  upsert("candidates", rows, "github_login");
export const recordSourceRuns = (rows: Record<string, unknown>[]) =>
  insert("source_runs", rows);
