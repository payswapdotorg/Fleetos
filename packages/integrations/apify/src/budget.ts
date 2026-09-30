/**
 * @fleetos/integration-apify — the usage/budget guard (W100C).
 *
 * Apify Free carries $5 of platform usage credit; when it is exhausted,
 * platform access is BLOCKED until the next cycle
 * (FREE-TIER-PROVIDER-MATRIX.md). The guard makes that boundary a
 * machine-stable REFUSAL instead of a provider-side surprise: every
 * discovery run reserves its cost BEFORE the transport fires, and an
 * exhausted ledger refuses with `budget_exhausted` (fail-visible).
 *
 * The ledger is an INJECTED seam (the reference implementation is
 * in-memory and per-process; a real deployment binds a durable counter).
 * Costs are INTEGER CENTS — no float arithmetic anywhere.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen } from "./internal";

// ---------------------------------------------------------------------------
// The budget seam
// ---------------------------------------------------------------------------

/** The result of a cost reservation attempt. */
export type BudgetReservation =
  | { readonly ok: true; readonly remainingCents: number }
  | {
      readonly ok: false;
      readonly reason: "budget_exhausted";
      readonly remainingCents: number;
    };

/**
 * The usage-budget seam: check-and-reserve, atomically. Implementations
 * MUST refuse (never queue silently) when the cost exceeds the remaining
 * credit.
 */
export interface ApifyUsageLedger {
  /** The remaining credit in integer cents (never negative). */
  readonly remainingCents: number;
  /**
   * Reserve `costCents` if the remaining credit covers it. A refused
   * reservation leaves the ledger UNCHANGED.
   */
  checkAndReserve(costCents: number): BudgetReservation;
  /**
   * Release a previously reserved cost (a transport failure that never
   * reached the provider spends nothing). Idempotent; never exceeds the
   * initial credit.
   */
  release(costCents: number): void;
}

/** Options for the in-memory reference ledger. */
export interface InMemoryUsageLedgerOptions {
  /**
   * The starting credit in integer cents. Default: 500 — the Apify Free
   * tier's $5 platform credit, expressed exactly.
   */
  readonly initialCents?: number;
}

/**
 * Create the in-memory reference usage ledger (deterministic; per
 * process). A durable deployment injects a persisted ledger instead.
 *
 * @param opts the ledger options
 * @returns the frozen ledger
 */
export function createInMemoryUsageLedger(
  opts: InMemoryUsageLedgerOptions = {},
): ApifyUsageLedger {
  const initial = opts.initialCents ?? 500;
  let remaining = initial;
  return frozen({
    get remainingCents(): number {
      return remaining;
    },
    checkAndReserve(costCents: number): BudgetReservation {
      if (!Number.isInteger(costCents) || costCents <= 0) {
        return { ok: false, reason: "budget_exhausted", remainingCents: remaining };
      }
      if (costCents > remaining) {
        return { ok: false, reason: "budget_exhausted", remainingCents: remaining };
      }
      remaining -= costCents;
      return { ok: true, remainingCents: remaining };
    },
    release(costCents: number): void {
      if (!Number.isInteger(costCents) || costCents <= 0) return;
      remaining = Math.min(initial, remaining + costCents);
    },
  });
}
