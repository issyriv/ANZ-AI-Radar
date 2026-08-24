// The scoring thesis lives with the fund profile (lib/fund.ts) so that the fund,
// its portfolio, its alumni list and its scoring dimensions stay in one place.
// This module is the UI-facing view of it.

import { ANTI_PATTERNS, THESIS_DIMENSIONS, type ThesisKey } from "./fund";

export const DURABILITY_QUESTIONS = THESIS_DIMENSIONS.map((d) => ({
  key: d.key,
  label: d.label,
  prompt: d.question,
}));

export type DurabilityKey = ThesisKey;
export { THESIS_DIMENSIONS, ANTI_PATTERNS };
