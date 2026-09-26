/**
 * @fleetos/audit — internal helpers (not exported from the package index).
 *
 * Zero runtime dependencies. Strict TS. No `any`.
 */

/**
 * Shallow-freeze a value and return it.
 *
 * @template T the record type
 * @param value the value to freeze
 * @returns the same value, frozen
 */
export function frozen<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Deterministic canonical JSON serialization: object keys are recursively
 * sorted, arrays preserve order, and the output is byte-identical for any
 * two JSON-serializable values that differ only in key order.
 *
 * Semantics mirror `JSON.stringify` for edge values: `undefined` (and
 * function/symbol-valued object properties) are dropped from objects,
 * `undefined` array elements serialize as `null`, and `NaN`/`Infinity`
 * serialize as `null`. Non-JSON-serializable scalars (`bigint`) throw.
 *
 * This is the canonical form the audit hash chain hashes — required for
 * audit-evidence reproducibility (same record content -> same hash, every
 * run, independent of property insertion order).
 *
 * @param value a JSON-serializable value
 * @returns the canonical JSON string
 * @throws TypeError when the value contains a bigint
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new TypeError("canonicalJson: bigint is not JSON-serializable");
    case "object":
      break;
    default:
      // function / symbol — only reachable at the top level; treat as null
      // (mirrors JSON.stringify dropping non-serializable values).
      return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalJson(element)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => {
      const element = record[key];
      return (
        element !== undefined &&
        typeof element !== "function" &&
        typeof element !== "symbol"
      );
    })
    .sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
  );
  return `{${parts.join(",")}}`;
}
