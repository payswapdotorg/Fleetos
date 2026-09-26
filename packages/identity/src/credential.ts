/**
 * @fleetos/identity — Credential/token shapes + validator seam (W012 D2).
 *
 * Token SHAPES only, per the work order: an opaque token value type, an
 * issued-credential record (issued-at / expiry / tenant binding), and an
 * INJECTED validator seam. There is no crypto runtime dependency and no
 * real auth server — the reference registry is an in-memory map whose token
 * values are opaque lookup keys (never parsed, never interpreted).
 *
 * Determinism: every timestamp is injected (`now` is a parameter, never a
 * clock read); the default token generator is a deterministic counter; the
 * same generator sequence produces the same tokens.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { Branded, TenantId, ValidationFailure } from "@fleetos/contracts";
import { brand } from "@fleetos/contracts";
import { frozen } from "./internal";
import { IdentityError, SYNTHETIC_SYSTEM_CORRELATION_ID } from "./errors";
import { SYNTHETIC_SYSTEM_TENANT_ID } from "./errors";
import { validationError } from "./errors";
import type { Principal } from "./principal";
import type { TenantContext } from "./tenant-context";
import { requireTenantContext } from "./tenant-context";

// ---------------------------------------------------------------------------
// Opaque token value type
// ---------------------------------------------------------------------------

/**
 * An opaque token value. Structurally a string at runtime; nominally
 * distinct so a raw string cannot be passed where a token is required.
 *
 * The token is OPAQUE: it is a lookup key for the issuing registry and
 * carries no parseable meaning. Nothing in this package interprets token
 * contents; the grammar below exists only to reject malformed inputs at the
 * boundary.
 */
export type OpaqueToken = Branded<string, "OpaqueToken">;

/**
 * Construct an `OpaqueToken` from a string. Use at issuance boundaries.
 *
 * @param value the token string
 * @returns the branded token
 */
export function asOpaqueToken(value: string): OpaqueToken {
  return brand<string, "OpaqueToken">(value);
}

/** The canonical opaque-token prefix. */
export const OPAQUE_TOKEN_PREFIX = "fst_" as const;

/**
 * The canonical opaque-token grammar: `fst_` followed by 24-128 URL-safe
 * base32 characters (lowercase a-z plus 0-9). Long enough to be collision
 * resistant for registry keys, short enough for headers.
 */
export const OPAQUE_TOKEN_PATTERN = /^fst_[a-z0-9]{24,128}$/;

/**
 * Pure grammar check for an opaque token candidate.
 *
 * @param token the candidate
 * @returns true when the candidate matches the canonical grammar
 */
export function isValidOpaqueToken(token: OpaqueToken): boolean {
  return typeof token === "string" && OPAQUE_TOKEN_PATTERN.test(token);
}

// ---------------------------------------------------------------------------
// Issued credential shape
// ---------------------------------------------------------------------------

/**
 * A credential issued to a principal. Carries the full binding set:
 * the token value, the tenant, the principal, issued-at/expiry (injected
 * timestamps — no clock reads), and the issuer identity.
 */
export interface IssuedCredential {
  /** The opaque token value (registry lookup key — never parsed). */
  readonly token: OpaqueToken;
  /** The tenant this credential is bound to (tenant isolation). */
  readonly tenantId: TenantId;
  /** The principal this credential authenticates. */
  readonly principal: Principal;
  /** ISO 8601 issuance timestamp (injected by the issuer). */
  readonly issuedAt: string;
  /** ISO 8601 expiry timestamp (issuedAt + ttlSeconds). */
  readonly expiresAt: string;
  /** The issuing authority identity (e.g. "identity.control-plane"). */
  readonly issuer: string;
}

/**
 * Compute the ISO 8601 expiry timestamp from an issuance timestamp and a
 * time-to-live. Pure and deterministic.
 *
 * @param issuedAt the ISO 8601 issuance timestamp
 * @param ttlSeconds the time-to-live in seconds (must be > 0)
 * @returns the ISO 8601 expiry timestamp
 * @throws IdentityError when issuedAt is not parseable ISO 8601 or the ttl
 *   is not a positive integer
 */
export function computeExpiry(issuedAt: string, ttlSeconds: number): string {
  const failures: ValidationFailure[] = [];
  if (typeof issuedAt !== "string" || !/T\d{2}:\d{2}/.test(issuedAt)) {
    failures.push({ path: "/issuedAt", reason: "not_iso8601" });
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    failures.push({ path: "/ttlSeconds", reason: "not_positive_integer" });
  }
  if (failures.length > 0) {
    throw new IdentityError(
      validationError(
        "identity.invalid_credential",
        "computeExpiry: invalid issuance inputs",
        failures,
        SYNTHETIC_SYSTEM_TENANT_ID,
        SYNTHETIC_SYSTEM_CORRELATION_ID,
      ),
    );
  }
  const ms = Date.parse(issuedAt);
  return new Date(ms + ttlSeconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Validator seam (injected — no crypto, no auth server)
// ---------------------------------------------------------------------------

/** The enumerable rejection reasons of the validator seam. */
export type TokenRejection =
  | "malformed_token"
  | "unknown_token"
  | "revoked"
  | "not_yet_valid"
  | "expired"
  | "tenant_mismatch"
  | "invalid_now";

/**
 * The result of a token validation. Tagged union so callers branch without
 * try/catch. `credential` is included on success so callers can surface
 * expiry metadata without a second lookup.
 */
export type TokenValidation =
  | { readonly ok: true; readonly principal: Principal; readonly credential: IssuedCredential }
  | { readonly ok: false; readonly reason: TokenRejection };

/**
 * The injected validator seam. Implementations validate an opaque token
 * against the acting `TenantContext` at the injected `now` timestamp.
 *
 * Production injects a real validator backed by the auth server; this
 * package ships only the shape and a reference in-memory registry.
 */
export interface TokenValidator {
  /**
   * Validate a token for the acting context.
   *
   * @param token the opaque token
   * @param ctx the acting tenant context (tenant binding is enforced)
   * @param now the injected "current" ISO 8601 timestamp
   * @returns a tagged validation result
   */
  validate(token: OpaqueToken, ctx: TenantContext, now: string): TokenValidation;
}

/** Options for token issuance. */
export interface IssueTokenOptions {
  /** The injected issuance timestamp (no clock reads). */
  readonly now: string;
  /** Time-to-live in seconds (positive integer). */
  readonly ttlSeconds: number;
  /** The issuing authority identity recorded on the credential. */
  readonly issuer?: string;
  /**
   * Caller-supplied token value. When omitted, the registry's injected
   * generator produces the next token. Supply for deterministic tests.
   */
  readonly token?: OpaqueToken;
}

/**
 * The issuer seam: mints credentials and records revocations.
 */
export interface TokenIssuer {
  /**
   * Issue a credential for `principal`.
   *
   * @param principal the principal to authenticate
   * @param opts issuance options (injected timestamps)
   * @returns the frozen issued credential
   */
  issue(principal: Principal, opts: IssueTokenOptions): IssuedCredential;
  /**
   * Revoke a token permanently. Returns true when the token was known and
   * not already revoked.
   *
   * @param token the token to revoke
   * @returns true when revoked by this call
   */
  revoke(token: OpaqueToken): boolean;
}

/**
 * A registry that is both issuer and validator (the reference deployment
 * shape of the seam).
 */
export interface TokenRegistry extends TokenIssuer, TokenValidator {}

/** Options for the reference in-memory registry. */
export interface InMemoryTokenRegistryOptions {
  /**
   * Injected token generator. Default: a deterministic per-instance counter
   * producing `fst_` + zero-padded base32 (24 chars). Inject a generator for
   * deterministic tests or to wire a real entropy source in production.
   */
  readonly tokenGenerator?: () => OpaqueToken;
}

/**
 * Create the reference in-memory token registry: issue / revoke / validate
 * over an opaque-token -> credential map.
 *
 * Validation order (deterministic, first rejection wins):
 *   1. `malformed_token`  — grammar check (OPAQUE_TOKEN_PATTERN)
 *   2. `unknown_token`    — not issued by this registry
 *   3. `revoked`          — revoked via `revoke` (permanent)
 *   4. `not_yet_valid`    — injected `now` precedes `issuedAt`
 *   5. `expired`          — injected `now` is at or past `expiresAt`
 *   6. `tenant_mismatch`  — acting context tenant != credential tenant
 *   7. `invalid_now`      — `now` is not parseable ISO 8601 (fail-closed)
 *
 * @param opts registry options
 * @returns a frozen TokenRegistry
 */
export function createInMemoryTokenRegistry(
  opts: InMemoryTokenRegistryOptions = {},
): TokenRegistry {
  const issued = new Map<string, IssuedCredential>();
  const revoked = new Set<string>();

  const generator =
    opts.tokenGenerator ??
    (() => {
      let counter = 0;
      const self = (): OpaqueToken => {
        counter += 1;
        // 24-char lowercase base32 of the counter, zero-padded: deterministic
        // per registry instance and within the canonical grammar.
        const digits = counter.toString(36).padStart(24, "0").slice(-24);
        return asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${digits}`);
      };
      return self;
    })();

  function checkNow(now: string): number | undefined {
    if (typeof now !== "string" || !/T\d{2}:\d{2}/.test(now)) return undefined;
    const ms = Date.parse(now);
    return Number.isNaN(ms) ? undefined : ms;
  }

  return frozen({
    issue(principal: Principal, issueOpts: IssueTokenOptions): IssuedCredential {
      const token = issueOpts.token ?? generator();
      if (!isValidOpaqueToken(token)) {
        throw new IdentityError(
          validationError(
            "identity.invalid_credential",
            "issue: token value does not satisfy the opaque-token grammar",
            [{ path: "/token", reason: "bad_token_grammar" }],
            principal.tenantId,
            SYNTHETIC_SYSTEM_CORRELATION_ID,
          ),
        );
      }
      const credential: IssuedCredential = frozen({
        token,
        tenantId: principal.tenantId,
        principal,
        issuedAt: issueOpts.now,
        expiresAt: computeExpiry(issueOpts.now, issueOpts.ttlSeconds),
        issuer: issueOpts.issuer ?? "identity.control-plane",
      });
      issued.set(token, credential);
      return credential;
    },

    revoke(token: OpaqueToken): boolean {
      if (!issued.has(token)) return false;
      if (revoked.has(token)) return false;
      revoked.add(token);
      return true;
    },

    validate(token: OpaqueToken, ctx: TenantContext, now: string): TokenValidation {
      // 1. grammar.
      if (!isValidOpaqueToken(token)) {
        return { ok: false, reason: "malformed_token" };
      }
      // 2. known.
      const credential = issued.get(token);
      if (credential === undefined) {
        return { ok: false, reason: "unknown_token" };
      }
      // 3. revocation (permanent once recorded).
      if (revoked.has(token)) {
        return { ok: false, reason: "revoked" };
      }
      // 4/5/7. time checks against the injected `now` (fail-closed).
      const nowMs = checkNow(now);
      if (nowMs === undefined) {
        return { ok: false, reason: "invalid_now" };
      }
      const issuedMs = Date.parse(credential.issuedAt);
      if (nowMs < issuedMs) {
        return { ok: false, reason: "not_yet_valid" };
      }
      const expiresMs = Date.parse(credential.expiresAt);
      if (nowMs >= expiresMs) {
        return { ok: false, reason: "expired" };
      }
      // 6. tenant binding against the acting context (guard also rejects a
      //    context-free call outright).
      const actingTenant = requireTenantContext(ctx);
      if (actingTenant !== credential.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      return { ok: true, principal: credential.principal, credential };
    },
  });
}
