/**
 * @fleetos/contracts — Versioned<T> + assertVersion() guard.
 *
 * Every cross-module contract that carries a payload is wrapped in a
 * `Versioned<T>` shape so that the consumer can branch on
 * `schemaVersion` before interpreting the payload. This is the
 * structural basis for forward/backward compatibility: a consumer that
 * does not understand a version MUST refuse the payload rather than
 * silently misinterpret it.
 *
 * Versioning discipline (documented):
 *   1. Additive changes (new optional fields) MAY be made within a major
 *      schemaVersion. Consumers MUST tolerate unknown fields.
 *   2. Breaking changes (field renames, type changes, semantic shifts)
 *      require a NEW schemaVersion + a migration note in the
 *      owning module's documentation. The old version MUST remain
 *      readable until all consumers have migrated.
 *   3. The `schemaVersion` integer starts at 1 and increments
 *      monotonically. There is no `0` version.
 *
 * Reference: `spec/ARCHITECTURE.md` § Canonical model ("Diagnoses,
 * predictions and recommendations are versioned interpretations") and
 * `spec/ARCHITECTURE-LOCK.md` item 3 ("derived diagnoses/recommendations
 * are versioned").
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

/**
 * The minimum legal schemaVersion. Versions below 1 are reserved and MUST
 * be rejected by `assertVersion()`.
 */
export const MIN_SCHEMA_VERSION = 1;

/**
 * A versioned payload wrapper. The `data` field is the payload; the
 * `schemaVersion` field records the version of the schema used to encode
 * `data`. Consumers branch on `schemaVersion` before interpreting `data`.
 *
 * @template T the payload type
 */
export interface Versioned<T> {
  /** The schema version (>= 1). */
  readonly schemaVersion: number;
  /** The versioned payload. */
  readonly data: T;
}

/**
 * The result of an `assertVersion` call. Tagged-union so callers can
 * branch on the failure mode without try/catch.
 */
export type VersionAssertion =
  | { ok: true; schemaVersion: number }
  | { ok: false; reason: "version_below_one" | "version_unknown_to_consumer"; received: number };

/**
 * Assert that a `Versioned<T>` carries a schema version that the consumer
 * understands. Returns a tagged result; does NOT throw.
 *
 * The `knownVersions` parameter is the set of versions the consumer is
 * prepared to handle. If the payload's `schemaVersion` is not in this set,
 * the assertion fails with `version_unknown_to_consumer` — the consumer
 * MUST refuse the payload rather than attempt to interpret it.
 *
 * @param payload the versioned payload to assert
 * @param knownVersions the set of schema versions the consumer understands
 * @returns the assertion result
 */
export function assertVersion<T>(
  payload: Versioned<T>,
  knownVersions: readonly number[],
): VersionAssertion {
  if (typeof payload.schemaVersion !== "number" || payload.schemaVersion < MIN_SCHEMA_VERSION) {
    return { ok: false, reason: "version_below_one", received: payload.schemaVersion };
  }
  if (!knownVersions.includes(payload.schemaVersion)) {
    return { ok: false, reason: "version_unknown_to_consumer", received: payload.schemaVersion };
  }
  return { ok: true, schemaVersion: payload.schemaVersion };
}

/**
 * Pure helper: wrap a payload in a `Versioned<T>`. Returns a frozen record.
 *
 * @template T the payload type
 * @param data the payload
 * @param schemaVersion the schema version (>= 1)
 * @returns a frozen versioned payload
 */
export function makeVersioned<T>(data: T, schemaVersion: number): Versioned<T> {
  return Object.freeze({ schemaVersion, data });
}
