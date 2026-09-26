/**
 * @fleetos/audit — Injectable hash function seam (W012 D3).
 *
 * The hash chain hashes record content through an INJECTED function — no
 * runtime dependency, no crypto library. The reference implementation below
 * is FNV-1a 32-bit: deterministic across runs and platforms, sufficient for
 * the in-memory reference deployment and for tamper DETECTION in tests.
 * Production injects a real cryptographic hash (e.g. SHA-256) at the
 * storage boundary — the seam, not the algorithm, is the contract.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

/**
 * The injectable hash function: maps a canonical string to a stable digest
 * string. Implementations MUST be deterministic (same input -> same output,
 * every run, every platform).
 */
export type HashFn = (canonical: string) => string;

/**
 * The prior-hash sentinel carried by the FIRST record of every chain: a
 * well-known constant, not a computed hash. Chains start from genesis.
 */
export const AUDIT_GENESIS_HASH = "genesis" as const;

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * The reference hash: FNV-1a 32-bit, hex-encoded (8 lowercase hex chars).
 *
 * Deterministic (pure integer arithmetic via `Math.imul`, no entropy, no
 * platform variance). NOT cryptographic — collision resistance is 32 bits.
 * Suitable for the in-memory reference deployment and tests; production
 * MUST inject a cryptographic hash through the `HashFn` seam.
 *
 * @param canonical the canonical string to hash
 * @returns the 8-char lowercase hex digest
 */
export function fnv1a32Hex(canonical: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
