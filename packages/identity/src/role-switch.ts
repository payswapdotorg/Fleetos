/**
 * @fleetos/identity — the auditable active-role switch (W100C D4).
 *
 * THE W100C core semantic: one human holds several roles in the same
 * tenant; switching the active role changes the EXPERIENCE lens, never
 * the tenant, never the effective permission set.
 *
 * The frozen rules (spec/ui/ROLE-EXPERIENCE-MATRIX.yaml `rules:`):
 *   - `active_role_is_scoped_to_current_tenant` — the switch validates
 *     against the CURRENT tenant's assignments ONLY; a target role whose
 *     assignment lives in another tenant is REFUSED (`role_not_assigned`
 *     — existence never leaks across tenants);
 *   - `role_switch_never_changes_tenant` — the output session record
 *     carries the SAME tenantId as the input (asserted by construction
 *     and by test);
 *   - `role_switch_is_audited` — EVERY switch writes the audit trail:
 *     successes emit `identity.role.switched`; refusals emit
 *     `identity.role.switch_denied` with a denied outcome and
 *     machine-stable reasons;
 *   - `experience_profiles_do_not_grant_permissions` — the switch writes
 *     the presentation SELECTOR on the session record only; the
 *     authoritative assigned-role set lives in the role-assignment
 *     repository and is never widened by a switch;
 *   - `effective_permissions_come_from_identity_and_guardian` — the
 *     effective permission fold (resolvePermissions) is computed from
 *     the ASSIGNED set, not the active-role selector; this service
 *     never grants, checks or stores permissions.
 *
 * Deterministic: every timestamp injected; assignment resolution reuses
 * the frozen `resolvePermissions` fold evaluated at the injected `now`
 * (fail-closed on malformed expiry — the W012 discipline).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, FleetError, TenantId } from "@fleetos/contracts";
import { asCorrelationId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { TenantContext } from "./tenant-context";
import { makeTenantContext } from "./tenant-context";
import type { RoleAssignment, RoleDefinition } from "./roles";
import { resolvePermissions } from "./roles";
import type { SessionRecord, SessionRepository } from "./durable/repositories";
import type { IdentityAuditSink } from "./identity-audit-seam";
import { IDENTITY_AUDIT_ACTIONS, NOOP_IDENTITY_AUDIT_SINK } from "./identity-audit-seam";

// ---------------------------------------------------------------------------
// Inputs / results
// ---------------------------------------------------------------------------

/** The input of `switchActiveRole`. */
export interface RoleSwitchInput {
  /** The injected switch instant (no clock reads). */
  readonly now: string;
  /** The session whose active-role selector changes. */
  readonly sessionId: string;
  /** The target role name. */
  readonly targetRole: string;
  /**
   * The CURRENT tenant's role definitions (injected — the caller loads
   * them from wherever the tenant keeps its catalog).
   */
  readonly roleDefinitions: readonly RoleDefinition[];
  readonly correlationId: CorrelationId;
}

/** The machine-stable refusal reasons of a role switch. */
export type RoleSwitchRefusal =
  | "session_unknown"
  | "tenant_mismatch"
  | "session_expired"
  | "session_revoked"
  | "role_unknown"
  | "role_not_assigned"
  | "invalid_input";

/** The durable outcome of a SUCCESSFUL role switch (or clear). */
export interface RoleSwitchedResult {
  readonly ok: true;
  /** The updated session record (same tenant — ALWAYS). */
  readonly session: SessionRecord;
  /** The previous active-role selector (null = role-neutral). */
  readonly fromRole: string | null;
  /** The new active-role selector (null after a clear). */
  readonly toRole: string | null;
}

/** The tagged result of a role switch. */
export type RoleSwitchResult =
  | RoleSwitchedResult
  | {
      readonly ok: false;
      readonly reason: RoleSwitchRefusal;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The injected dependencies of the role-switch service. */
export interface RoleSwitchServiceDeps {
  readonly sessions: SessionRepository;
  /**
   * The assignment source: the CURRENT tenant's assignments (the caller
   * loads them tenant-scoped — e.g. the durable role-assignment
   * repository's `listAssignments(ctx)`).
   */
  readonly assignmentsOf: (ctx: TenantContext) => readonly RoleAssignment[];
  readonly auditSink?: IdentityAuditSink;
}

/** Parse an ISO 8601 instant; undefined when unparseable (fail-closed). */
function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Create the auditable role-switch service.
 *
 * @param deps the injected session repository + assignment source + sink
 * @returns the frozen service
 */
export function createRoleSwitchService(deps: RoleSwitchServiceDeps) {
  const audit: IdentityAuditSink = deps.auditSink ?? NOOP_IDENTITY_AUDIT_SINK;

  /** The denied-switch audit emission (machine-stable reasons). */
  function auditDenied(
    tenantId: TenantId,
    input: RoleSwitchInput,
    actorPrincipalId: string,
    reasons: readonly string[],
  ): void {
    audit.append({
      tenantId,
      action: IDENTITY_AUDIT_ACTIONS.roleSwitchDenied,
      subject: input.sessionId,
      actorPrincipalId,
      occurredAt: input.now,
      correlationId: input.correlationId,
      details: {
        sessionId: input.sessionId,
        targetRole: input.targetRole,
        reasons: Object.freeze([...reasons]),
      },
    });
  }

  return frozen({
    /**
     * SWITCH the active role. The switch:
     *   1. loads the session (unknown in this tenant => refused);
     *   2. enforces the CURRENT-tenant scope (the session's tenant must
     *      equal the acting context's tenant — `tenant_mismatch`
     *      otherwise: A ROLE SWITCH NEVER CHANGES TENANT);
     *   3. validates the session is live at the injected `now`
     *      (fail-closed on unparseable times);
     *   4. resolves the principal's ASSIGNED roles in the current tenant
     *      via the frozen permission fold;
     *   5. refuses when the target role is unknown
     *      (`role_unknown`) or not assigned (`role_not_assigned`);
     *   6. writes the new SELECTOR onto the session record (the tenant,
     *      principal, issued/expiry/revocation fields are UNTOUCHED);
     *   7. audits `identity.role.switched` (from -> to).
     *
     * Refusals audit `identity.role.switch_denied`. Idempotent switches
     * (same target as current) STILL audit — every switch writes the
     * audit trail.
     */
    switchActiveRole(
      ctx: TenantContext,
      input: RoleSwitchInput,
    ): RoleSwitchResult {
      const actingTenant = ctx.tenantId;
      if (typeof input.targetRole !== "string" || input.targetRole.length === 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "switchActiveRole: targetRole must be a non-empty string",
        };
      }
      const nowMs = parseIsoMs(input.now);
      if (nowMs === undefined) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "switchActiveRole: `now` must be a parseable ISO 8601 instant",
        };
      }

      const session = deps.sessions.getSession(ctx, input.sessionId);
      if (session === undefined || session.tenantId !== actingTenant) {
        // Existence never leaks across tenants: a foreign session is
        // indistinguishable from an unknown one.
        const reasons = session === undefined ? ["session_unknown"] : ["tenant_mismatch"];
        auditDenied(actingTenant, input, "unknown", reasons);
        return {
          ok: false,
          reason: session === undefined ? "session_unknown" : "tenant_mismatch",
          message:
            session === undefined
              ? "switchActiveRole: no such session in the acting tenant"
              : "switchActiveRole: the session belongs to a different tenant — a role switch never changes tenant",
        };
      }
      if (session.revokedAt !== null) {
        auditDenied(actingTenant, input, session.principalId, ["session_revoked"]);
        return {
          ok: false,
          reason: "session_revoked",
          message: "switchActiveRole: the session is revoked",
        };
      }
      // Fail-closed: an unparseable session expiry treats it as expired.
      const expiryMs = parseIsoMs(session.expiresAt);
      if (expiryMs === undefined || nowMs >= expiryMs) {
        auditDenied(actingTenant, input, session.principalId, ["session_expired"]);
        return {
          ok: false,
          reason: "session_expired",
          message: "switchActiveRole: the session is expired (fail-closed on malformed expiry)",
        };
      }

      // The authoritative assignment fold — CURRENT tenant, at `now`.
      // resolvePermissions filters by (tenantId, principalId) itself;
      // foreign records contribute nothing (isolation).
      const resolved = resolvePermissions(
        {
          kind: session.principalKind,
          principalId: session.principalId,
          tenantId: session.tenantId,
        },
        deps.assignmentsOf(ctx),
        input.roleDefinitions,
        input.now,
      );

      const knownRole = input.roleDefinitions.find(
        (definition) => definition.name === input.targetRole,
      );
      if (knownRole === undefined) {
        auditDenied(actingTenant, input, session.principalId, [
          "role_unknown",
          input.targetRole,
        ]);
        return {
          ok: false,
          reason: "role_unknown",
          message: `switchActiveRole: role ${input.targetRole} is not a known role definition`,
        };
      }
      if (!resolved.roles.includes(input.targetRole)) {
        auditDenied(actingTenant, input, session.principalId, [
          "role_not_assigned",
          input.targetRole,
        ]);
        return {
          ok: false,
          reason: "role_not_assigned",
          message: `switchActiveRole: principal ${session.principalId} is not assigned role ${input.targetRole} in tenant ${actingTenant}`,
        };
      }

      // The selector write: SAME tenant, SAME principal, SAME lifecycle
      // fields — only activeRole and lastSeenAt move.
      const updated: SessionRecord = frozen({
        ...session,
        activeRole: input.targetRole,
        lastSeenAt: input.now,
      });
      const write = deps.sessions.updateSession(ctx, updated);
      if (!write.ok) {
        auditDenied(actingTenant, input, session.principalId, ["session_unknown"]);
        return {
          ok: false,
          reason: "session_unknown",
          message: "switchActiveRole: the session disappeared before the switch completed",
        };
      }

      audit.append({
        tenantId: actingTenant,
        action: IDENTITY_AUDIT_ACTIONS.roleSwitched,
        subject: session.sessionId,
        actorPrincipalId: session.principalId,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          sessionId: session.sessionId,
          fromRole: session.activeRole,
          toRole: input.targetRole,
          assignedRoles: resolved.roles,
          tenantUnchanged: true,
        },
      });

      return {
        ok: true,
        session: updated,
        fromRole: session.activeRole,
        toRole: input.targetRole,
      };
    },

    /**
     * CLEAR the active-role selector (role-neutral presentation). Same
     * guards as a switch; audited as a switch to null. Never changes
     * tenant.
     */
    clearActiveRole(
      ctx: TenantContext,
      input: Omit<RoleSwitchInput, "targetRole" | "roleDefinitions">,
    ): RoleSwitchResult {
      const actingTenant = ctx.tenantId;
      const nowMs = parseIsoMs(input.now);
      if (nowMs === undefined) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "clearActiveRole: `now` must be a parseable ISO 8601 instant",
        };
      }
      const session = deps.sessions.getSession(ctx, input.sessionId);
      if (session === undefined || session.tenantId !== actingTenant) {
        return {
          ok: false,
          reason: session === undefined ? "session_unknown" : "tenant_mismatch",
          message: "clearActiveRole: no such session in the acting tenant",
        };
      }
      if (session.revokedAt !== null) {
        return {
          ok: false,
          reason: "session_revoked",
          message: "clearActiveRole: the session is revoked",
        };
      }
      const expiryMs = parseIsoMs(session.expiresAt);
      if (expiryMs === undefined || nowMs >= expiryMs) {
        return {
          ok: false,
          reason: "session_expired",
          message: "clearActiveRole: the session is expired (fail-closed)",
        };
      }
      const updated: SessionRecord = frozen({
        ...session,
        activeRole: null,
        lastSeenAt: input.now,
      });
      const write = deps.sessions.updateSession(ctx, updated);
      if (!write.ok) {
        return {
          ok: false,
          reason: "session_unknown",
          message: "clearActiveRole: the session disappeared before the clear completed",
        };
      }
      audit.append({
        tenantId: actingTenant,
        action: IDENTITY_AUDIT_ACTIONS.roleSwitched,
        subject: session.sessionId,
        actorPrincipalId: session.principalId,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          sessionId: session.sessionId,
          fromRole: session.activeRole,
          toRole: null,
          assignedRoles: [],
          tenantUnchanged: true,
        },
      });
      return {
        ok: true,
        session: updated,
        fromRole: session.activeRole,
        toRole: null,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// The effective-permissions projection (pure — for the shell)
// ---------------------------------------------------------------------------

/**
 * The role-aware session projection the shell consumes: the session's
 * presentation selector, the authoritative assigned-role set, and the
 * effective permissions from the frozen fold — THREE DISTINCT things
 * (the matrix rules made structural).
 */
export interface RoleAwareSessionProjection {
  readonly tenantId: TenantId;
  readonly principalId: string;
  /** The presentation selector (may be null). */
  readonly activeRole: string | null;
  /** The authoritative assigned roles (sorted-unique). */
  readonly assignedRoles: readonly string[];
  /** The effective permissions (sorted-unique) — from the fold. */
  readonly effectivePermissions: readonly string[];
  /** Assignment deviations disclosed for auditability. */
  readonly skipped: readonly { readonly roleName: string; readonly reason: string }[];
}

/**
 * Project the role-aware session view. PURE: the active-role selector
 * never widens the assigned set or the effective permissions (asserted
 * by test: swapping the selector changes NOTHING but `activeRole`).
 *
 * @param session the session record
 * @param assignments the CURRENT tenant's assignments
 * @param roleDefinitions the CURRENT tenant's role definitions
 * @param now the injected evaluation time
 */
export function projectRoleAwareSession(
  session: SessionRecord,
  assignments: readonly RoleAssignment[],
  roleDefinitions: readonly RoleDefinition[],
  now: string,
): RoleAwareSessionProjection {
  const resolved = resolvePermissions(
    {
      kind: session.principalKind,
      principalId: session.principalId,
      tenantId: session.tenantId,
    },
    assignments,
    roleDefinitions,
    now,
  );
  return frozen({
    tenantId: session.tenantId,
    principalId: session.principalId,
    activeRole: session.activeRole,
    assignedRoles: resolved.roles,
    effectivePermissions: resolved.permissions,
    skipped: resolved.skipped,
  });
}

/** The FleetError projection of a refused switch (for API translation). */
export function roleSwitchRefusalError(refusal: {
  readonly reason: RoleSwitchRefusal;
  readonly message: string;
  readonly tenantId: TenantId;
  readonly principalId: string;
}): FleetError {
  return frozen({
    kind: "AuthorizationError",
    code: `identity.role.switch.${refusal.reason}`,
    message: refusal.message,
    principalId: refusal.principalId,
    action: "identity.role.switch",
    reason: refusal.reason,
    tenantId: refusal.tenantId,
    correlationId: asCorrelationId("cor_system"),
  });
}
