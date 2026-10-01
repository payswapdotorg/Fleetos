/**
 * @fleetos/identity — the password-credential seam + service (W121).
 *
 * Proper authentication's account-credential truth: the
 * `PasswordHasher` SEAM (a pure computation contract — NO crypto
 * dependency inside this package), the password-credential RECORD
 * shape (account/tenant binding, salt, verifier, injected
 * timestamps), and the credential service over the W100C durable
 * record seam (register + verify), mirroring how session/principal
 * records are shaped and persisted.
 *
 * SEAM DISCIPLINE (the work order's law):
 *   - identity owns ONLY the seam + the record shape. The hash
 *     IMPLEMENTATION is injected: tests/local tier inject the
 *     deterministic reference hasher below; the composition root
 *     injects the real implementation (an iterated SHA-256 in the
 *     console's browser tier — see apps/web/src/runtime/product-session.ts;
 *     a server-side KDF at the future Neon binding).
 *   - The PLAIN password never persists: only `salt` + `verifier`
 *     (the hasher output) are stored, and neither ever flows into an
 *     audit record's details (ids only) nor into any client payload.
 *   - Fail-closed refusals are machine-stable and distinguish
 *     `unknown_account` from `wrong_password` (never a fabricated
 *     success, never a silent no-op).
 *   - No clock reads: `createdAt` is an injected timestamp.
 *   - No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import { makeTenantContext } from "./tenant-context";
import type { IdentityAuditSink } from "./identity-audit-seam";
import { IDENTITY_AUDIT_ACTIONS, NOOP_IDENTITY_AUDIT_SINK } from "./identity-audit-seam";
import type { PasswordCredentialRecord, PasswordCredentialRepository } from "./durable/repositories";
import { passwordCredentialIdOf } from "./durable/repositories";

// ---------------------------------------------------------------------------
// The PasswordHasher seam (pure computation — injected implementation)
// ---------------------------------------------------------------------------

/**
 * The password-hash seam: pure functions from (plain, salt) to a
 * verifier. Implementations MUST be deterministic — `verify` is
 * exactly `hash(plain, salt) === verifier`.
 *
 * NO crypto dependency lives inside identity: this package ships only
 * the contract plus the deterministic non-cryptographic REFERENCE
 * hasher (below) for the local/test tier; the composition root
 * injects the real implementation.
 */
export interface PasswordHasher {
  /**
   * Derive the stored verifier from the plain password and its salt.
   *
   * @param plain the plain password (never stored, never rendered)
   * @param salt the per-credential salt
   * @returns the verifier string to persist
   */
  hash(plain: string, salt: string): string;
  /**
   * Verify a plain password against the stored verifier.
   *
   * @param plain the plain password attempt
   * @param salt the stored per-credential salt
   * @param verifier the stored verifier
   * @returns true when the attempt matches
   */
  verify(plain: string, salt: string, verifier: string): boolean;
}

/** Generates a fresh per-credential salt (injected; deterministic default). */
export type PasswordSaltGenerator = () => string;

/**
 * The minimum plain-password length the service accepts (machine-stable
 * `invalid_input` refusal below it). A deliberately modest floor: the
 * product tier's honest minimum, not a password policy claim.
 */
export const MIN_PASSWORD_LENGTH = 8 as const;

/**
 * The reference (NON-cryptographic) hasher — the local/test tier's
 * deterministic default, exactly like `joinCodeHash` is the reference
 * join-code hash: production injects a real KDF at the composition
 * root. FNV-1a style double accumulation over `salt :: plain`, 64
 * rounds, rendered as a stable `pwv_<hex>` verifier.
 *
 * @returns the frozen reference PasswordHasher
 */
export function createReferencePasswordHasher(): PasswordHasher {
  function derive(plain: string, salt: string): string {
    const input = `${salt}::${plain}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193 ^ (plain.length << 3);
    for (let round = 0; round < 64; round += 1) {
      for (let i = 0; i < input.length; i += 1) {
        h1 ^= input.charCodeAt(i) + round;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= h1 + i;
        h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      }
    }
    return `pwv_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  }
  return frozen({
    hash: (plain: string, salt: string): string => derive(plain, salt),
    verify: (plain: string, salt: string, verifier: string): boolean =>
      typeof verifier === "string" && derive(plain, salt) === verifier,
  });
}

// ---------------------------------------------------------------------------
// The credential service (register + verify) over the durable seam
// ---------------------------------------------------------------------------

/** The input of `registerCredential`. */
export interface RegisterCredentialInput {
  /** The injected registration instant (no clock reads). */
  readonly now: string;
  /** The tenant the credential belongs to. */
  readonly tenantId: TenantId;
  /** The credential's principal id (`usr:` grammar). */
  readonly principalId: string;
  /** The sign-in member reference (the member's email). */
  readonly memberRef: string;
  /** The plain password (hashed through the injected seam; never stored). */
  readonly plainPassword: string;
  /** The creating principal id (audit actor). */
  readonly createdBy: string;
  readonly correlationId: CorrelationId;
}

/** The input of `verifyCredential`. */
export interface VerifyCredentialInput {
  /** The tenant to verify within (partition-scoped lookup). */
  readonly tenantId: TenantId;
  /** The sign-in member reference (the member's email). */
  readonly memberRef: string;
  /** The plain password attempt (flows only into the seam call). */
  readonly plainPassword: string;
  readonly correlationId: CorrelationId;
}

/**
 * The machine-stable refusal reasons of the credential service.
 * `unknown_account` (no credential record for the member reference in
 * the acting tenant) is deliberately DISTINCT from `wrong_password`
 * (a known credential whose verifier does not match) — the W121 law.
 */
export type PasswordCredentialRefusal =
  | "invalid_input"
  | "credential_already_exists"
  | "unknown_account"
  | "wrong_password"
  | "credential_revoked";

/** The tagged result of a credential registration. */
export type RegisterCredentialResult =
  | { readonly ok: true; readonly credential: PasswordCredentialRecord }
  | {
      readonly ok: false;
      readonly reason: PasswordCredentialRefusal;
      readonly message: string;
    };

/** The tagged result of a credential verification. */
export type VerifyCredentialResult =
  | {
      readonly ok: true;
      readonly tenantId: TenantId;
      readonly principalId: string;
      readonly memberRef: string;
    }
  | {
      readonly ok: false;
      readonly reason: PasswordCredentialRefusal;
      readonly message: string;
    };

/** Parse an ISO 8601 instant; undefined when unparseable (fail-closed). */
function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The injected dependencies of the password-credential service. */
export interface PasswordCredentialServiceDeps {
  /** The durable credential repository (the W100C record seam). */
  readonly credentials: PasswordCredentialRepository;
  /** The injected hasher seam (NO crypto dependency inside identity). */
  readonly hasher: PasswordHasher;
  /** The injected salt generator (deterministic default). */
  readonly saltGenerator?: PasswordSaltGenerator;
  /** The audit sink (append-only; ids only — never salt/verifier/plain). */
  readonly auditSink?: IdentityAuditSink;
}

/**
 * Create the password-credential service.
 *
 * `registerCredential` persists a new credential record (verifier +
 * salt; the plain password is hashed through the injected seam and
 * discarded) and audits `identity.credential.created`.
 * `verifyCredential` is a pure lookup + hash comparison (never
 * audited — the read discipline; refusals are machine-stable).
 *
 * @param deps the injected repository + hasher + salt generator + audit sink
 * @returns the frozen service
 */
export function createPasswordCredentialService(deps: PasswordCredentialServiceDeps) {
  const audit: IdentityAuditSink = deps.auditSink ?? NOOP_IDENTITY_AUDIT_SINK;
  let saltCounter = 0;
  const nextSalt: PasswordSaltGenerator =
    deps.saltGenerator ??
    (() => {
      saltCounter += 1;
      return `slt_w100c${String(saltCounter).padStart(16, "0")}`;
    });

  return frozen({
    /**
     * REGISTER a password credential: validate the inputs (fail-closed),
     * derive the verifier through the injected seam, persist the record,
     * audit the transition. Deterministic; every timestamp injected.
     */
    registerCredential(input: RegisterCredentialInput): RegisterCredentialResult {
      if (typeof input.plainPassword !== "string" || input.plainPassword.length < MIN_PASSWORD_LENGTH) {
        return {
          ok: false,
          reason: "invalid_input",
          message: `registerCredential: the password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
        };
      }
      if (typeof input.principalId !== "string" || input.principalId.length === 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "registerCredential: a non-empty principal id is required",
        };
      }
      if (typeof input.memberRef !== "string" || input.memberRef.trim().length === 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "registerCredential: a non-empty member reference is required",
        };
      }
      if (parseIsoMs(input.now) === undefined) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "registerCredential: `now` must be a parseable ISO 8601 instant",
        };
      }
      const ctx = makeTenantContext(input.tenantId, input.correlationId);
      const existing = deps.credentials.getCredentialByPrincipal(ctx, input.principalId);
      if (existing !== undefined) {
        return {
          ok: false,
          reason: "credential_already_exists",
          message: `registerCredential: principal ${input.principalId} already holds a credential in ${input.tenantId}`,
        };
      }
      const salt = nextSalt();
      const verifier = deps.hasher.hash(input.plainPassword, salt);
      const record: PasswordCredentialRecord = frozen({
        tenantId: input.tenantId,
        credentialId: passwordCredentialIdOf(input.tenantId, input.principalId),
        principalId: input.principalId,
        memberRef: input.memberRef.trim(),
        salt,
        verifier,
        createdAt: input.now,
        createdBy: input.createdBy,
        revokedAt: null,
      });
      const put = deps.credentials.putCredential(ctx, record);
      if (!put.ok) {
        return {
          ok: false,
          reason: put.reason === "already_exists" ? "credential_already_exists" : "invalid_input",
          message: `registerCredential: credential persist refused (${put.reason})`,
        };
      }
      // Ids only — the salt/verifier/plain never enter the audit trail.
      audit.append({
        tenantId: record.tenantId,
        action: IDENTITY_AUDIT_ACTIONS.credentialCreated,
        subject: record.credentialId,
        actorPrincipalId: input.createdBy,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          credentialId: record.credentialId,
          principalId: record.principalId,
          memberRef: record.memberRef,
        },
      });
      return { ok: true, credential: record };
    },

    /**
     * VERIFY a sign-in attempt: partition-scoped member lookup
     * (unknown account never leaks across tenants), revocation check,
     * then the injected seam's verify against the stored salt +
     * verifier. Fail-closed and machine-stable; never audited (the
     * read discipline — pure lookups never audit).
     */
    verifyCredential(input: VerifyCredentialInput): VerifyCredentialResult {
      if (
        typeof input.memberRef !== "string" ||
        input.memberRef.trim().length === 0 ||
        typeof input.plainPassword !== "string" ||
        input.plainPassword.length === 0
      ) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "verifyCredential: a member reference and password are required",
        };
      }
      const ctx = makeTenantContext(input.tenantId, input.correlationId);
      const record = deps.credentials.getCredentialByMemberRef(ctx, input.memberRef.trim());
      if (record === undefined) {
        return {
          ok: false,
          reason: "unknown_account",
          message: `verifyCredential: no password credential for ${input.memberRef} in this workspace`,
        };
      }
      if (record.revokedAt !== null) {
        return {
          ok: false,
          reason: "credential_revoked",
          message: `verifyCredential: the credential for ${input.memberRef} was revoked`,
        };
      }
      const matches = deps.hasher.verify(input.plainPassword, record.salt, record.verifier);
      if (!matches) {
        return {
          ok: false,
          reason: "wrong_password",
          message: "verifyCredential: the password does not match the stored verifier",
        };
      }
      return {
        ok: true,
        tenantId: record.tenantId,
        principalId: record.principalId,
        memberRef: record.memberRef,
      };
    },
  });
}
