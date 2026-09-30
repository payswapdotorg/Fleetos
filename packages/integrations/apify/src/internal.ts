/**
 * @fleetos/integration-apify — internal helpers (not exported from the
 * package index).
 *
 * Zero runtime dependencies. Strict TS. No `any`.
 */

/** Shallow-freeze a value and return it. */
export function frozen<T>(value: T): T {
  return Object.freeze(value);
}

/** Freeze a copy of an array; the input is never mutated. */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

/** Deterministic string comparison (-1/0/1) for stable sorts. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
