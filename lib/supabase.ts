import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Single server-side client using the SECRET (service_role) key.
// Used by both the ingestion scripts and Next.js server components / route handlers.
// Lazy so the dev server can boot even before env vars are filled in.
let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || url.includes("TODO") || key.includes("TODO")) {
    throw new Error(
      "Supabase env not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
