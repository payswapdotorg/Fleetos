/**
 * @fleetos/identity — internal helpers (not exported from the package index).
 *
 * Zero runtime dependencies. Strict TS. No `any`.
 */

/**
 * Shallow-freeze a value and return it. Used by every public constructor so
 * that domain records are immutable at the first level (nested readonly
 * arrays are frozen by their constructors where this package creates them).
 *
 * @template T the record type
 * @param value the value to freeze
 * @returns the same value, frozen
 */
export function frozen<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Freeze a copy of an array (the lane-C listing discipline). The input is
 * never mutated.
 *
 * @template T the element type
 * @param values the array to copy-and-freeze
 * @returns the frozen copy
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}
