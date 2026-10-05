/**
 * @fleetos/web — W140: the server-plane entropy seam.
 *
 * SERVER-ONLY (apps/web/src/server). Every high-entropy value the server
 * control plane mints — enrollment codes (the W130 shape: base32,
 * ~100-bit bodies), agent trust tokens, session-scoped ids — derives
 * from ONE injectable byte source. Production reads Web Crypto
 * (`crypto.getRandomValues` — fail-closed when unavailable: the server
 * NEVER falls back to weak entropy for credentials); deterministic
 * tests inject their own source.
 *
 * The identity/device packages' purity law (no entropy inside packages)
 * holds: all randomness is injected HERE, at the composition boundary.
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */

import { frozen } from "./server-internal";

/** The injectable entropy source: `n` fresh uniformly random bytes. */
export type EntropySource = (n: number) => Uint8Array;

/** The W130 code alphabet: RFC 4648 base32 (A-Z, 2-7) — unambiguous + power-of-two. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" as const;

/** The hex alphabet (trust-token bodies). */
const HEX = "0123456789abcdef" as const;

/** The enrollment-code grammar prefix (human-recognizable; the body carries the entropy). */
export const ENROLLMENT_CODE_PREFIX = "enrollw" as const;

/** The enrollment-code body length: 20 base32 chars = 100 bits (the W130 shape). */
export const ENROLLMENT_CODE_BODY_LENGTH = 20 as const;

/** The frozen enrollment-code grammar, as a regex. */
export const ENROLLMENT_CODE_PATTERN = `${ENROLLMENT_CODE_PREFIX}[A-Z2-7]{${ENROLLMENT_CODE_BODY_LENGTH}}` as const;

/**
 * W147 — the workspace-join-code grammar (the member-invitation redemption
 * credential). Structural twin of the enrollment-code grammar: the `joinw`
 * prefix carries a 20-char base32 body (~100 bits). The grammar is the
 * dispatch key for the redeem route (join codes route to the workspace
 * lifecycle's joinWorkspace; enroll codes continue the device-enrollment
 * path unchanged).
 */
export const JOIN_CODE_PREFIX = "joinw" as const;

/** The join-code body length: 20 base32 chars = 100 bits (the W130 shape). */
export const JOIN_CODE_BODY_LENGTH = 20 as const;

/** The frozen join-code grammar, as a regex. */
export const JOIN_CODE_PATTERN = `${JOIN_CODE_PREFIX}[A-Z2-7]{${JOIN_CODE_BODY_LENGTH}}` as const;

/** The agent trust-token grammar prefix (opaque to the agent; a lookup key, never parsed). */
export const TRUST_TOKEN_PREFIX = "fagt_" as const;

/** The trust-token body length: 32 hex chars = 128 bits. */
export const TRUST_TOKEN_BODY_LENGTH = 32 as const;

/**
 * The production entropy source: Web Crypto's uniform bytes.
 * Fail-closed: when `crypto.getRandomValues` is unavailable the source
 * THROWS (weak entropy for server-issued credentials is never silent).
 */
export const CRYPTO_ENTROPY: EntropySource = (n: number): Uint8Array => {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("server entropy: crypto.getRandomValues is unavailable (fail-closed)");
  }
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};

/** A deterministic entropy source for tests (a counter over bytes). */
export function createCounterEntropy(): EntropySource {
  let counter = 0;
  return (n: number): Uint8Array => {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      bytes[i] = (counter + i * 7) % 256;
    }
    counter += 1;
    return bytes;
  };
}

/** Derive a base32 string of `length` chars from the entropy source (bias-free: 32 | 256). */
function base32Of(source: EntropySource, length: number): string {
  const bytes = source(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += BASE32_ALPHABET[bytes[i]! % 32]!;
  }
  return out;
}

/** Derive a lowercase-hex string of `length` chars from the entropy source. */
function hexOf(source: EntropySource, length: number): string {
  const bytes = source(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += HEX[bytes[i]! % 16]!;
  }
  return out;
}

/** The server-plane entropy toolkit (one source, many grammars). */
export interface ServerEntropy {
  /** A fresh enrollment code (W130 shape: `enrollw` + 20 base32 chars). */
  enrollmentCode(): string;
  /**
   * W147 — a fresh workspace-join code (the member-invitation credential;
   * `joinw` + 20 base32 chars; structural twin of the enrollment code).
   */
  joinCode(): string;
  /** A fresh agent trust token (`fagt_` + 32 hex chars). */
  trustToken(): string;
  /** A fresh server correlation id (`cor_w140s` + 16 hex chars). */
  correlationId(): string;
  /** Fresh lowercase-hex chars (id bodies). */
  hex(length: number): string;
}

/**
 * Build the entropy toolkit over a source.
 *
 * @param source the entropy source (default: Web Crypto, fail-closed)
 */
export function createServerEntropy(source: EntropySource = CRYPTO_ENTROPY): ServerEntropy {
  return frozen({
    enrollmentCode(): string {
      return `${ENROLLMENT_CODE_PREFIX}${base32Of(source, ENROLLMENT_CODE_BODY_LENGTH)}`;
    },
    joinCode(): string {
      return `${JOIN_CODE_PREFIX}${base32Of(source, JOIN_CODE_BODY_LENGTH)}`;
    },
    trustToken(): string {
      return `${TRUST_TOKEN_PREFIX}${hexOf(source, TRUST_TOKEN_BODY_LENGTH)}`;
    },
    correlationId(): string {
      return `cor_w140s${hexOf(source, 16)}`;
    },
    hex(length: number): string {
      return hexOf(source, length);
    },
  });
}

/** Does the value match the frozen enrollment-code grammar? */
export function isEnrollmentCodeShape(value: string): boolean {
  return typeof value === "string" && new RegExp(`^${ENROLLMENT_CODE_PATTERN}$`).test(value);
}

/**
 * W147 — does the value match the frozen join-code grammar? (The dispatch
 * key for the redeem route's member-join path.)
 */
export function isJoinCodeShape(value: string): boolean {
  return typeof value === "string" && new RegExp(`^${JOIN_CODE_PATTERN}$`).test(value);
}
