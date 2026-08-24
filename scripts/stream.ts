import "./_bootstrap";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { getCompany } from "../lib/companies-house";
import { companyNumberFrom, isShareAllotment, listenFilings } from "../lib/ch-stream";
import { sicLooksTech, hubCity, nameLooksAI } from "../lib/formations";
import { normalizeName } from "../lib/extract";
import { loadCompanies } from "../lib/store";

// Live UK funding feed. Free: stream + REST, no model calls.
//
//   npx tsx scripts/stream.ts              # listen for 5 minutes
//   STREAM_MINUTES=60 npx tsx scripts/stream.ts
//
// Every SH01 in the country arrives here. We keep the ones filed by companies
// with technology SIC codes and record them with the timepoint, so a restart
// resumes exactly where it stopped rather than leaving a hole in coverage.

const OUT = process.env.STREAM_OUT ?? ".data/raises.json";
const STATE = ".data/stream-state.json";
const MINUTES = Number(process.env.STREAM_MINUTES ?? 5);

interface Raise {
  company_number: string; company_name: string; filed_on: string;
  sic_codes: string[]; hq_city: string | null; incorporated_on: string | null;
  name_signals_ai: boolean; already_known: boolean; seen_at: string;
}

async function main() {
  const known = new Set((await loadCompanies()).map((c) => c.name_normalized).filter(Boolean));
  const out: Raise[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).raises ?? [] : [];
  const seen = new Set(out.map((r) => r.company_number + r.filed_on));
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

  let filings = 0, allotments = 0, tech = 0;
  console.log(`[stream] listening ${MINUTES} min${state.timepoint ? ` from timepoint ${state.timepoint}` : ""}`);

  const last = await listenFilings({
    timepoint: state.timepoint,
    durationMs: MINUTES * 60_000,
    onEvent: async (f) => {
      filings++;
      if (!isShareAllotment(f)) return;
      allotments++;
      const num = companyNumberFrom(f.resource_uri);
      if (!num) return;
      const co = await getCompany(num);            // one REST call per allotment only
      if (!co) return;
      const sics = co.sic_codes ?? [];
      if (!sicLooksTech(sics)) return;             // filter to technology filers
      tech++;
      const key = num + (f.data?.date ?? "");
      if (seen.has(key)) return;
      seen.add(key);
      const r: Raise = {
        company_number: num, company_name: co.company_name,
        filed_on: f.data?.date ?? new Date().toISOString().slice(0, 10),
        sic_codes: sics,
        hq_city: hubCity(co.registered_office_address?.locality, co.registered_office_address?.postal_code),
        incorporated_on: co.date_of_creation ?? null,
        name_signals_ai: nameLooksAI(co.company_name),
        already_known: known.has(normalizeName(co.company_name)),
        seen_at: new Date().toISOString(),
      };
      out.push(r);
      console.log(`[raise] ${r.company_name.padEnd(38)} ${r.hq_city ?? "?"} · inc ${String(r.incorporated_on).slice(0,10)} · SIC ${sics.join(",")}${r.name_signals_ai ? " · AI-name" : ""}${r.already_known ? " · known" : " · NEW"}`);
    },
  });

  writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), count: out.length, raises: out }, null, 2));
  if (last) writeFileSync(STATE, JSON.stringify({ timepoint: last }));
  console.log(`\n[stream] ${filings} filings seen · ${allotments} share allotments · ${tech} from tech companies`);
  console.log(`[stream] ${out.filter((r) => !r.already_known).length} of ${out.length} stored raises are NOT in the deal-flow map -> ${OUT}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
