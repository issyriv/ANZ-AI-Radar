import "./_bootstrap";

// Preflight: verify env + connectivity before running the pipeline.
// npm run check

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s: string) => `\x1b[33m•\x1b[0m ${s}`;

function isSet(v: string | undefined): boolean {
  return !!v && !v.includes("TODO");
}

async function main() {
  console.log("\nANZ AI Radar — preflight\n");

  // --- env presence ---
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    APP_PASSWORD: process.env.APP_PASSWORD,
  };
  for (const [k, v] of Object.entries(env)) {
    console.log(isSet(v) ? ok(`${k} set`) : warn(`${k} not set yet`));
  }
  console.log("");

  // --- Supabase connectivity + schema ---
  if (isSet(env.SUPABASE_URL) && isSet(env.SUPABASE_SECRET_KEY)) {
    try {
      const { getSupabaseAdmin } = await import("../lib/supabase");
      const sb = getSupabaseAdmin();
      const { error, count } = await sb
        .from("candidates")
        .select("*", { count: "exact" })
        .limit(1);
      if (error) {
        if (/does not exist|schema cache|find the table/i.test(error.message)) {
          console.log(bad(`Supabase connected, but 'candidates' table missing — apply supabase/schema.sql in the SQL editor`));
        } else {
          console.log(bad(`Supabase error: ${error.message}`));
        }
      } else {
        console.log(ok(`Supabase connected — candidates table has ${count ?? 0} rows`));
        // write probe: upsert + delete a sentinel row to confirm writes work
        const probe = { github_login: "__preflight_probe__", github_id: 0 };
        const { error: wErr } = await sb
          .from("candidates")
          .upsert(probe, { onConflict: "github_login" });
        if (wErr) {
          console.log(bad(`Supabase WRITE failed: ${wErr.message}`));
        } else {
          await sb.from("candidates").delete().eq("github_login", "__preflight_probe__");
          console.log(ok("Supabase write/upsert works"));
        }
      }
    } catch (e) {
      console.log(bad(`Supabase: ${(e as Error).message}`));
    }
  } else {
    console.log(warn("Supabase check skipped (url/secret not set)"));
  }

  // --- GitHub token + rate limit ---
  if (isSet(env.GITHUB_TOKEN)) {
    try {
      const res = await fetch("https://api.github.com/rate_limit", {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "User-Agent": "anz-ai-radar",
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { resources: { core: { remaining: number; limit: number } } };
        const c = data.resources.core;
        console.log(ok(`GitHub token valid — core rate limit ${c.remaining}/${c.limit} remaining`));
      } else {
        console.log(bad(`GitHub token rejected (HTTP ${res.status})`));
      }
    } catch (e) {
      console.log(bad(`GitHub: ${(e as Error).message}`));
    }
  } else {
    console.log(warn("GitHub check skipped (token not set)"));
  }

  // --- Anthropic key (presence only; no spend) ---
  if (isSet(env.ANTHROPIC_API_KEY)) {
    console.log(
      env.ANTHROPIC_API_KEY!.startsWith("sk-ant-")
        ? ok("Anthropic key present (format looks right)")
        : warn("Anthropic key present but doesn't start with sk-ant-"),
    );
  } else {
    console.log(warn("Anthropic check skipped (key not set)"));
  }

  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
