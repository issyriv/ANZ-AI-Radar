// Reads the Companies House scan output for the UI.
//
// Formations live in flat JSON rather than the companies table on purpose: they
// are not the same kind of object. A funded company has a product, a stage and
// a durability score; a three-month-old formation has a name, a director and a
// filing date. Forcing them into one table would mean pretending we know things
// about the formations that we do not.

import { existsSync, readFileSync } from "fs";
import type { Formation } from "./formations";

export interface Triage {
  venture_likelihood: number;
  likely_focus: string;
  why_interesting: string;
  recommended_action: string;
  confidence: number;
}

export type ScoredFormation = Formation & { triage?: Triage };

const SCORED = process.env.CH_SCORED_OUT ?? ".data/formations-scored.json";
const RAW = process.env.CH_OUT ?? ".data/formations.json";

export function loadFormations(): { formations: ScoredFormation[]; generatedAt: string | null; triaged: boolean } {
  // Prefer the triaged file; fall back to the raw scan so the page still works
  // before the (paid) triage pass has been run.
  for (const [path, triaged] of [[SCORED, true], [RAW, false]] as const) {
    if (!existsSync(path)) continue;
    try {
      const d = JSON.parse(readFileSync(path, "utf8")) as {
        formations?: ScoredFormation[];
        generated_at?: string;
      };
      if (d.formations?.length) {
        return { formations: d.formations, generatedAt: d.generated_at ?? null, triaged };
      }
    } catch {
      /* try the next one */
    }
  }
  return { formations: [], generatedAt: null, triaged: false };
}
