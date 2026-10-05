/**
 * @fleetos/web — W140: the server-tier PasswordHasher.
 *
 * SERVER-ONLY (apps/web/src/server). The identity package's W121 law:
 * the hasher is an INJECTED seam (pure computation, no crypto
 * dependency inside identity). The browser composition injects the
 * W121 iterated-salted-SHA-256 hasher (1000 rounds — a demo/local KDF);
 * "a server-side KDF replaces it at the future Neon binding" — this IS
 * that binding: the same algorithm shape (salted iterated SHA-256 over
 * the `pwv_` verifier grammar) with a STRONGER default round count.
 *
 * Cross-tier compatibility is PROVEN BY TEST: at the browser round
 * count this hasher derives byte-identical verifiers to the W121
 * browser hasher (same salt format, same chain), so a verifier created
 * by either tier verifies under the other — one algorithm, two tiers.
 *
 * The plain password NEVER persists (only the verifier + salt — the
 * identity seam's law). No `any`. Strict TS.
 */

import type { PasswordHasher } from "@fleetos/identity";
import { sha256Hex } from "../runtime/sha256";
import { frozen } from "./server-internal";

/** The server-tier rounds: 10x the browser demo KDF (a real server-side work factor). */
export const SERVER_PASSWORD_ROUNDS = 10_000 as const;

/**
 * Create the server-tier password hasher.
 *
 * @param rounds the iteration count (defaults to SERVER_PASSWORD_ROUNDS;
 *   tests may pin the browser round count for compatibility proofs)
 */
export function createServerPasswordHasher(rounds: number = SERVER_PASSWORD_ROUNDS): PasswordHasher {
  function derive(plain: string, salt: string): string {
    let acc = sha256Hex(`${salt}::fleetos-password::${plain}`);
    for (let round = 1; round < rounds; round += 1) {
      acc = sha256Hex(`${acc}${salt}`);
    }
    return `pwv_${acc}`;
  }
  return frozen({
    hash: (plain: string, salt: string): string => derive(plain, salt),
    verify: (plain: string, salt: string, verifier: string): boolean =>
      typeof verifier === "string" && derive(plain, salt) === verifier,
  });
}
