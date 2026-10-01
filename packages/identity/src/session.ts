/**
 * @fleetos/identity — the durable session service (W100C D3).
 *
 * The persistent browser-session lifecycle over the durable session
 * repository: open -> resolve -> touch -> (switch role | clear role) ->
 * revoke. Every timestamp is injected (no clock reads); tokens are
 * OPAQUE lookup keys (the fst_ grammar from `credential.ts` — never
 * parsed, never interpreted).
 *
 * ACTIVE-ROLE SEMANTICS (the ROLE-EXPERIENCE-MATRIX rules, encoded):
 *   - the active role is a SELECTOR stored on the session record
 *     (presentation only — "session UI state as a selector" per
 *     ROLEFUL-UX-ARCHITECTURE § Role switch contract);
 *   - the AUTHORITATIVE assigned-role set lives in the role-assignment
 *     repository, NEVER on the session;
 *   - `activeRole` is scoped to the session's CURRENT tenant — a session
 *     belongs to exactly one tenant for its whole lifetime;
 *   - switching roles NEVER changes tenant (see role-switch.ts).
 *
 * Resolution is fail-closed and deterministic: an unparseable `now`
 * treats every time-boxed record as expired (the W012 credential
 * discipline carried forward).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { asCorrelationId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { TenantContext } from "./tenant-context";
import { makeTenantContext } from "./tenant-context";
import type { Principal } from "./principal";
import { computeExpiry } from "./credential";
import { asOpaqueToken, isValidOpaqueToken } from "./credential";
import type { SessionRecord, SessionRepository } from "./durable/repositories";
import type { IdentityAuditSink } from "./identity-audit-seam";
import { IDENTITY_AUDIT_ACTIONS, NOOP_IDENTITY_AUDIT_SINK } from "./identity-audit-seam";

// ---------------------------------------------------------------------------
// Inputs / results
// ---------------------------------------------------------------------------

/** The input of `openSession`. */
export interface OpenSessionInput {
  /** The injected issuance instant (no clock reads). */
  readonly now: string;
  /** Time-to-live in seconds (positive integer). */
  readonly ttlSeconds: number;
  /** The authenticated principal (tenant-bound). */
  readonly principal: Principal;
  /**
   * The initial active-role selector, when the caller resolved one (the
   * authoritative assignment check is the CALLER's — this service only
   * records the presentation selector).
   */
  readonly initialActiveRole?: string;
  /** The issuing authority identity recorded on the session. */
  readonly issuer?: string;
  readonly correlationId: CorrelationId;
}

/** The machine-stable session-resolution outcomes. */
export type SessionResolution =
  | { readonly ok: true; readonly session: SessionRecord }
  | {
      readonly ok: false;
      readonly reason:
        | "malformed_token"
        | "unknown_token"
        | "expired"
        | "revoked"
        | "invalid_now";
    };

/** The machine-stable refusal reasons of session writes. */
export type SessionWriteRefusal = "invalid_input" | "already_exists" | "unknown_session";

// ---------------------------------------------------------------------------
// Generator seams
// ---------------------------------------------------------------------------

/** Generates a fresh session token (must satisfy the fst_ grammar). */
export type SessionTokenGenerator = () => string;

/** Generates a fresh session id. */
export type SessionIdGenerator = () => string;

/** Options for the deterministic reference generators. */
export interface SessionGeneratorOptions {
  readonly token?: SessionTokenGenerator;
  readonly sessionId?: SessionIdGenerator;
}

/** Parse an ISO 8601 instant; undefined when unparseable (fail-closed). */
function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The injected dependencies of the session service. */
export interface SessionServiceDeps {
  readonly sessions: SessionRepository;
  readonly auditSink?: IdentityAuditSink;
  readonly generators?: SessionGeneratorOptions;
}

/**
 * Create the durable session service.
 *
 * @param deps the injected session repository + audit sink + generators
 * @returns the frozen service
 */
export function createSessionService(deps: SessionServiceDeps) {
  const audit: IdentityAuditSink = deps.auditSink ?? NOOP_IDENTITY_AUDIT_SINK;

  let tokenCounter = 0;
  let sessionCounter = 0;
  const nextToken: SessionTokenGenerator =
    deps.generators?.token ??
    (() => {
      tokenCounter += 1;
      // "w100c" + 19 digits = 24 grammar-conforming chars after `fst_`.
      return `fst_w100c${String(tokenCounter).padStart(19, "0")}`;
    });
  const nextSessionId: SessionIdGenerator =
    deps.generators?.sessionId ??
    (() => {
      sessionCounter += 1;
      return `ses_w100c${String(sessionCounter).padStart(16, "0")}`;
    });

  /** Project the principal's member ref by kind (flat storage). */
  function memberRefOf(principal: Principal): string {
    switch (principal.kind) {
      case "user":
        return principal.userId;
      case "service":
        return principal.serviceName;
      case "agent":
        return principal.deviceId;
    }
  }

  return frozen({
    /**
     * OPEN a durable session: mint the token + record, persist, audit
     * `identity.session.opened`. Deterministic; timestamps injected.
     */
    openSession(
      input: OpenSessionInput,
    ): { readonly ok: true; readonly session: SessionRecord } | { readonly ok: false; readonly reason: SessionWriteRefusal; readonly message: string } {
      if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "openSession: ttlSeconds must be a positive integer",
        };
      }
      if (parseIsoMs(input.now) === undefined) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "openSession: `now` must be a parseable ISO 8601 instant",
        };
      }
      const expiresAt = computeExpiry(input.now, input.ttlSeconds);
      const token = nextToken();
      if (!isValidOpaqueToken(asOpaqueToken(token))) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "openSession: the token generator produced a non-conforming token",
        };
      }
      const ctx = makeTenantContext(input.principal.tenantId, input.correlationId);
      const record: SessionRecord = frozen({
        tenantId: input.principal.tenantId,
        sessionId: nextSessionId(),
        token,
        principalId: input.principal.principalId,
        principalKind: input.principal.kind,
        principalMemberRef: memberRefOf(input.principal),
        activeRole: input.initialActiveRole ?? null,
        issuedAt: input.now,
        expiresAt,
        lastSeenAt: input.now,
        revokedAt: null,
        issuer: input.issuer ?? "identity.control-plane",
      });
      const put = deps.sessions.putSession(ctx, record);
      if (!put.ok) {
        return {
          ok: false,
          reason: put.reason === "tenant_mismatch" ? "invalid_input" : "already_exists",
          message: `openSession: session persist refused (${put.reason})`,
        };
      }
      audit.append({
        tenantId: record.tenantId,
        action: IDENTITY_AUDIT_ACTIONS.sessionOpened,
        subject: record.sessionId,
        actorPrincipalId: record.principalId,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          sessionId: record.sessionId,
          ttlSeconds: input.ttlSeconds,
          issuer: record.issuer,
        },
      });
      return { ok: true, session: record };
    },

    /**
     * RESOLVE a session by token at the injected `now`. Fail-closed:
     * unknown token, expiry (unparseable now => expired), revocation.
     * The `TenantContext` scopes the lookup — a token issued in tenant A
     * is UNKNOWN in tenant B (existence never leaks across tenants).
     * Resolution touches `lastSeenAt` (bookkeeping — not consequential,
     * never audited; documented judgment call).
     */
    resolveSession(
      ctx: TenantContext,
      token: string,
      now: string,
    ): SessionResolution {
      const tenantId = ctx.tenantId;
      if (typeof token !== "string" || !isValidOpaqueToken(asOpaqueToken(token))) {
        return { ok: false, reason: "malformed_token" };
      }
      const nowMs = parseIsoMs(now);
      if (nowMs === undefined) {
        return { ok: false, reason: "invalid_now" };
      }
      const record = deps.sessions.getSessionByToken(ctx, token);
      if (record === undefined || record.tenantId !== tenantId) {
        return { ok: false, reason: "unknown_token" };
      }
      if (record.revokedAt !== null) {
        return { ok: false, reason: "revoked" };
      }
      // Fail-closed: an unparseable expiry treats the session as expired.
      const expiryMs = parseIsoMs(record.expiresAt);
      if (expiryMs === undefined || nowMs >= expiryMs) {
        return { ok: false, reason: "expired" };
      }
      const touched: SessionRecord = frozen({ ...record, lastSeenAt: now });
      const updated = deps.sessions.updateSession(ctx, touched);
      if (updated.ok) {
        return { ok: true, session: touched };
      }
      return { ok: true, session: record };
    },

    /**
     * REVOKE a session permanently. Audited
     * (`identity.session.revoked`). Idempotent: revoking a revoked
     * session returns the existing record WITHOUT a second audit record.
     */
    revokeSession(
      ctx: TenantContext,
      sessionId: string,
      now: string,
      correlationId?: CorrelationId,
    ): { readonly ok: true; readonly session: SessionRecord } | { readonly ok: false; readonly reason: "unknown_session" } {
      const record = deps.sessions.getSession(ctx, sessionId);
      if (record === undefined) {
        return { ok: false, reason: "unknown_session" };
      }
      if (record.revokedAt !== null) {
        return { ok: true, session: record };
      }
      const revoked: SessionRecord = frozen({ ...record, revokedAt: now, lastSeenAt: now });
      const updated = deps.sessions.updateSession(ctx, revoked);
      if (!updated.ok) {
        return { ok: false, reason: "unknown_session" };
      }
      audit.append({
        tenantId: record.tenantId,
        action: IDENTITY_AUDIT_ACTIONS.sessionRevoked,
        subject: sessionId,
        actorPrincipalId: record.principalId,
        occurredAt: now,
        correlationId: correlationId ?? asCorrelationId("cor_system"),
        details: { sessionId, issuedAt: record.issuedAt },
      });
      return { ok: true, session: revoked };
    },
  });
}

// ---------------------------------------------------------------------------
// The active-role session semantics (pure helpers)
// ---------------------------------------------------------------------------

/**
 * The machine-stable ROLE-EXPERIENCE-MATRIX rules this lane encodes
 * (tests match on these literals):
 *   - experience_profiles_do_not_grant_permissions;
 *   - effective_permissions_come_from_identity_and_guardian;
 *   - active_role_is_scoped_to_current_tenant;
 *   - role_switch_is_audited;
 *   - role_switch_never_changes_tenant;
 *   - unavailable_capabilities_show_reason_and_escalation_path.
 */
export const ACTIVE_ROLE_MATRIX_RULES: readonly string[] = Object.freeze([
  "experience_profiles_do_not_grant_permissions",
  "effective_permissions_come_from_identity_and_guardian",
  "active_role_is_scoped_to_current_tenant",
  "role_switch_is_audited",
  "role_switch_never_changes_tenant",
  "unavailable_capabilities_show_reason_and_escalation_path",
] as const);

/**
 * Pure: is the session's active-role selector valid for display in the
 * CURRENT tenant scope? The selector is tenant-scoped by construction
 * (the session carries exactly one tenant for its lifetime).
 *
 * @param session the session record
 * @param tenantId the acting tenant
 * @returns true when the session belongs to the acting tenant
 */
export function sessionBelongsToTenant(session: SessionRecord, tenantId: TenantId): boolean {
  return session.tenantId === tenantId;
}
