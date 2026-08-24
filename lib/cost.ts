// Running cost meter with a hard budget stop.
//
// The pipeline makes hundreds of model calls across ~70 sources. Without a
// meter it is very easy to discover the spend only after the fact, so every
// call reports its usage here and the run aborts cleanly once the budget is hit.
//
// Rates are $ per million tokens (Anthropic first-party, 2026-06):
//   claude-haiku-4-5   $1.00 in / $5.00 out
//   claude-sonnet-4-6  $3.00 in / $15.00 out
// Cache writes bill at 1.25x the input rate; cache reads at 0.1x.

import type Anthropic from "@anthropic-ai/sdk";

const RATES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-5": { in: 5.0, out: 25.0 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const PER_M = 1_000_000;

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(`budget exhausted: spent $${spent.toFixed(4)} of $${budget.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  usd: number;
}

const totals: Totals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  usd: 0,
};

/** Hard ceiling in USD. 0 or unset disables the check. */
export const BUDGET_USD = Number(process.env.LLM_BUDGET_USD ?? 0);

export function record(model: string, usage: Anthropic.Usage | undefined): void {
  if (!usage) return;
  const rate = RATES[model] ?? RATES["claude-sonnet-4-6"];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;

  totals.calls++;
  totals.inputTokens += inTok;
  totals.outputTokens += outTok;
  totals.cacheWriteTokens += cw;
  totals.cacheReadTokens += cr;
  totals.usd +=
    (inTok * rate.in +
      cw * rate.in * CACHE_WRITE_MULTIPLIER +
      cr * rate.in * CACHE_READ_MULTIPLIER +
      outTok * rate.out) /
    PER_M;
}

/** Throw if we have spent the budget. Called before each model request. */
export function assertBudget(): void {
  if (BUDGET_USD > 0 && totals.usd >= BUDGET_USD) {
    throw new BudgetExceededError(totals.usd, BUDGET_USD);
  }
}

export const spentUsd = () => totals.usd;

export function summary(): string {
  const cacheHitRate =
    totals.cacheReadTokens + totals.cacheWriteTokens > 0
      ? (100 * totals.cacheReadTokens) / (totals.cacheReadTokens + totals.cacheWriteTokens)
      : 0;
  return (
    `[cost] ${totals.calls} calls · ` +
    `in ${totals.inputTokens.toLocaleString()} · out ${totals.outputTokens.toLocaleString()} · ` +
    `cache w/r ${totals.cacheWriteTokens.toLocaleString()}/${totals.cacheReadTokens.toLocaleString()} ` +
    `(${cacheHitRate.toFixed(0)}% read) · ` +
    `$${totals.usd.toFixed(4)}` +
    (BUDGET_USD > 0 ? ` of $${BUDGET_USD.toFixed(2)} budget` : "")
  );
}

export function logSummary(): void {
  console.log(summary());
}
