/**
 * @fleetos/identity — the durable repositories (W100C D2).
 *
 * The tenant/workspace/principal/role-assignment/session repositories
 * over the `DurableRecordStore` seam (Neon at the W102 binding; the
 * in-memory reference for local/test). Every operation takes the acting
 * `TenantContext` FIRST and touches only the acting tenant's partition —
 * the persistence-boundary tenant isolation of LOCK 17.
 *
 * The repositories are TRANSLATION only: domain records <-> flat rows.
 * Domain rules (idempotency, lifecycle transitions, audit) live in the
 * service layer (`workspace.ts`, `session.ts`, `role-switch.ts`) — never
 * here, so the same rules hold over any durable implementation.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { FleetError, TenantId } from "@fleetos/contracts";
import { asTenantId, asUserId } from "@fleetos/contracts";
import type { TenantContext } from "../tenant-context";
import { requireTenantContext } from "../tenant-context";
import { authorizationError, SYNTHETIC_SYSTEM_CORRELATION_ID } from "../errors";
import { frozen } from "../internal";
import type { Principal, PrincipalKind } from "../principal";
import { makeUserPrincipal } from "../principal";
import type { RoleAssignment } from "../roles";
import { makeRoleAssignment } from "../roles";
import type { DurableRecordStore, DurableStoredRow } from "./seam";
import type { DurableRow } from "./tables";

// ---------------------------------------------------------------------------
// Row <-> record translation helpers
// ---------------------------------------------------------------------------

/** Read a text column (non-null). */
function text(row: DurableRow, column: string): string {
  return row[column] as string;
}

/** Read a nullable text column. */
function textOrNull(row: DurableRow, column: string): string | null {
  return (row[column] as string | null) ?? null;
}

/** Build a single-column filter row (the `where` input shape). */
function field(name: string, value: string | number | boolean | null): DurableRow {
  return { [name]: value };
}

/** The shared write-refusal reason union (duplicates + tenant mismatches). */
type WriteRefusal =
  | "already_exists"
  | "tenant_mismatch"
  | "unknown_session"
  | "unknown_invitation"
  | "unknown_credential";

// ---------------------------------------------------------------------------
// The workspace/tenant repository
// ---------------------------------------------------------------------------

/** The workspace lifecycle status. */
export type WorkspaceStatus = "active" | "archived";

/** A persistent workspace/tenant record. */
export interface WorkspaceRecord {
  readonly tenantId: TenantId;
  /** The workspace display name. */
  readonly name: string;
  /** The workspace status. */
  readonly status: WorkspaceStatus;
  /** ISO 8601 creation instant (injected). */
  readonly createdAt: string;
  /** The founding principal id. */
  readonly createdBy: string;
}

/** Options for the tenant repository. */
export interface TenantRepository {
  /** Persist a workspace record (insert; duplicate refusal on an existing key). */
  putWorkspace(
    ctx: TenantContext,
    record: WorkspaceRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** The acting tenant's workspace record, when present. */
  getWorkspace(ctx: TenantContext): WorkspaceRecord | undefined;
}

/** Create the durable tenant repository over the seam. */
export function createDurableTenantRepository(store: DurableRecordStore): TenantRepository {
  return frozen({
    putWorkspace(
      ctx: TenantContext,
      record: WorkspaceRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const row: DurableRow = frozen({
        tenant_id: record.tenantId,
        name: record.name,
        status: record.status,
        created_at: record.createdAt,
        created_by: record.createdBy,
      });
      const write = store.insert(ctx, "fleetos_tenants", record.tenantId, row);
      if (!write.ok && write.reason === "already_exists") {
        return { ok: false, reason: "already_exists" };
      }
      return { ok: true };
    },
    getWorkspace(ctx: TenantContext): WorkspaceRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const stored = store.get(ctx, "fleetos_tenants", tenantId);
      if (stored === undefined) return undefined;
      return frozen({
        tenantId,
        name: text(stored.row, "name"),
        status: text(stored.row, "status") as WorkspaceStatus,
        createdAt: text(stored.row, "created_at"),
        createdBy: text(stored.row, "created_by"),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// The principal repository
// ---------------------------------------------------------------------------

/** A persistent principal membership record. */
export interface PrincipalMembership {
  readonly tenantId: TenantId;
  readonly principalId: string;
  readonly kind: PrincipalKind;
  /** The kind's member reference (userId / serviceName / deviceId). */
  readonly memberRef: string;
  readonly displayName: string;
  readonly createdAt: string;
}

/** Options for the principal repository. */
export interface PrincipalRepository {
  /** Persist a principal membership (insert; duplicate refusal on an existing key). */
  putPrincipal(
    ctx: TenantContext,
    membership: PrincipalMembership,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** One principal by principal id (own partition only). */
  getPrincipal(ctx: TenantContext, principalId: string): PrincipalMembership | undefined;
  /** Every principal membership in the acting tenant, principalId order. */
  listPrincipals(ctx: TenantContext): readonly PrincipalMembership[];
}

/** Create the durable principal repository over the seam. */
export function createDurablePrincipalRepository(store: DurableRecordStore): PrincipalRepository {
  function toMembership(tenantId: TenantId, stored: DurableStoredRow): PrincipalMembership {
    return frozen({
      tenantId,
      principalId: text(stored.row, "principal_id"),
      kind: text(stored.row, "kind") as PrincipalKind,
      memberRef: text(stored.row, "member_ref"),
      displayName: text(stored.row, "display_name"),
      createdAt: text(stored.row, "created_at"),
    });
  }

  return frozen({
    putPrincipal(
      ctx: TenantContext,
      membership: PrincipalMembership,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== membership.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const row: DurableRow = frozen({
        tenant_id: membership.tenantId,
        principal_id: membership.principalId,
        kind: membership.kind,
        member_ref: membership.memberRef,
        display_name: membership.displayName,
        created_at: membership.createdAt,
      });
      const write = store.insert(
        ctx,
        "fleetos_principals",
        membership.principalId,
        row,
      );
      if (!write.ok && write.reason === "already_exists") {
        return { ok: false, reason: "already_exists" };
      }
      return { ok: true };
    },
    getPrincipal(ctx: TenantContext, principalId: string): PrincipalMembership | undefined {
      const tenantId = requireTenantContext(ctx);
      const stored = store.get(ctx, "fleetos_principals", principalId);
      return stored === undefined ? undefined : toMembership(tenantId, stored);
    },
    listPrincipals(ctx: TenantContext): readonly PrincipalMembership[] {
      const tenantId = requireTenantContext(ctx);
      return store.list(ctx, "fleetos_principals").map((stored) => toMembership(tenantId, stored));
    },
  });
}

// ---------------------------------------------------------------------------
// The role-assignment repository
// ---------------------------------------------------------------------------

/** The tenant-scoped role-assignment repository contract. */
export interface RoleAssignmentRepository {
  /**
   * Append a role assignment. IDEMPOTENT by (principalId, roleName):
   * an existing assignment row for the same pair returns
   * `{ ok: true, deduped: true }` WITHOUT a second row.
   */
  addAssignment(
    ctx: TenantContext,
    assignment: RoleAssignment,
  ): {
    readonly ok: true;
    readonly deduped: boolean;
    readonly assignmentId: string;
  } | { readonly ok: false; readonly error: FleetError };
  /** Every assignment in the acting tenant, assignment id order. */
  listAssignments(ctx: TenantContext): readonly RoleAssignment[];
  /** The acting tenant's assignments for one principal, assignment id order. */
  listForPrincipal(ctx: TenantContext, principalId: string): readonly RoleAssignment[];
}

/** The deterministic assignment id: `asn_` + fnv-free stable join. */
function assignmentIdOf(tenantId: TenantId, principalId: string, roleName: string): string {
  return `asn_${tenantId.slice(4)}_${principalId.replace(/[:]/g, "-")}_${roleName.replace(/[.]/g, "-")}`;
}

/** Create the durable role-assignment repository over the seam. */
export function createDurableRoleAssignmentRepository(
  store: DurableRecordStore,
): RoleAssignmentRepository {
  function toAssignment(stored: DurableStoredRow): RoleAssignment {
    return makeRoleAssignment({
      tenantId: asTenantId(text(stored.row, "tenant_id")),
      principalId: text(stored.row, "principal_id"),
      roleName: text(stored.row, "role_name"),
      assignedAt: text(stored.row, "assigned_at"),
      assignedBy: text(stored.row, "assigned_by"),
      ...(textOrNull(stored.row, "expires_at") !== null
        ? { expiresAt: textOrNull(stored.row, "expires_at") ?? undefined }
        : {}),
    });
  }

  return frozen({
    addAssignment(
      ctx: TenantContext,
      assignment: RoleAssignment,
    ): ReturnType<RoleAssignmentRepository["addAssignment"]> {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== assignment.tenantId) {
        return {
          ok: false,
          error: authorizationError(
            "identity.assignment.tenant_mismatch",
            "addAssignment: the assignment's tenant does not match the acting context",
            assignment.principalId,
            "identity.assignment.add",
            "tenant_mismatch",
            tenantId,
            ctx.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
          ),
        };
      }
      const assignmentId = assignmentIdOf(
        assignment.tenantId,
        assignment.principalId,
        assignment.roleName,
      );
      // Idempotency: an existing row for the same (principal, role) is a
      // dedupe — the authoritative assigned-role SET is unchanged.
      const existing = store.get(ctx, "fleetos_role_assignments", assignmentId);
      if (existing !== undefined) {
        return { ok: true, deduped: true, assignmentId };
      }
      const row: DurableRow = frozen({
        tenant_id: assignment.tenantId,
        assignment_id: assignmentId,
        principal_id: assignment.principalId,
        role_name: assignment.roleName,
        assigned_at: assignment.assignedAt,
        assigned_by: assignment.assignedBy,
        expires_at: assignment.expiresAt ?? null,
      });
      const write = store.insert(ctx, "fleetos_role_assignments", assignmentId, row);
      if (!write.ok) return { ok: false, error: write.error };
      return { ok: true, deduped: false, assignmentId };
    },
    listAssignments(ctx: TenantContext): readonly RoleAssignment[] {
      requireTenantContext(ctx);
      return store.list(ctx, "fleetos_role_assignments").map(toAssignment);
    },
    listForPrincipal(ctx: TenantContext, principalId: string): readonly RoleAssignment[] {
      requireTenantContext(ctx);
      return store
        .list(ctx, "fleetos_role_assignments", {
          where: frozen({ ...field("principal_id", principalId) }),
        })
        .map(toAssignment);
    },
  });
}

// ---------------------------------------------------------------------------
// The session repository
// ---------------------------------------------------------------------------

/** A persistent session record (see session.ts for the lifecycle rules). */
export interface SessionRecord {
  readonly tenantId: TenantId;
  /** Deterministic session id (`ses_` prefix). */
  readonly sessionId: string;
  /** The opaque session token (fst_ grammar; a lookup key, never parsed). */
  readonly token: string;
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly principalMemberRef: string;
  /**
   * The active-role SELECTOR — presentation only; may be null
   * (role-neutral). The authoritative assigned-role set lives in the
   * role-assignment repository.
   */
  readonly activeRole: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
  readonly issuer: string;
}

/** The tenant-scoped session repository contract. */
export interface SessionRepository {
  /** Persist a session record (insert; duplicate refusal on an existing id or token). */
  putSession(
    ctx: TenantContext,
    record: SessionRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** Overwrite a session record in place (lifecycle transitions only). */
  updateSession(
    ctx: TenantContext,
    record: SessionRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** One session by session id (own partition only). */
  getSession(ctx: TenantContext, sessionId: string): SessionRecord | undefined;
  /** One session by token (own partition only). */
  getSessionByToken(ctx: TenantContext, token: string): SessionRecord | undefined;
  /** The acting tenant's sessions for one principal, sessionId order. */
  listSessionsForPrincipal(ctx: TenantContext, principalId: string): readonly SessionRecord[];
  /** Remove a session record; true when removed. */
  removeSession(ctx: TenantContext, sessionId: string): boolean;
}

/** Create the durable session repository over the seam. */
export function createDurableSessionRepository(store: DurableRecordStore): SessionRepository {
  function toRecord(tenantId: TenantId, stored: DurableStoredRow): SessionRecord {
    return frozen({
      tenantId,
      sessionId: text(stored.row, "session_id"),
      token: text(stored.row, "token"),
      principalId: text(stored.row, "principal_id"),
      principalKind: text(stored.row, "principal_kind") as PrincipalKind,
      principalMemberRef: text(stored.row, "principal_member_ref"),
      activeRole: textOrNull(stored.row, "active_role"),
      issuedAt: text(stored.row, "issued_at"),
      expiresAt: text(stored.row, "expires_at"),
      lastSeenAt: text(stored.row, "last_seen_at"),
      revokedAt: textOrNull(stored.row, "revoked_at"),
      issuer: text(stored.row, "issuer"),
    });
  }

  function toRow(record: SessionRecord): DurableRow {
    return frozen({
      tenant_id: record.tenantId,
      session_id: record.sessionId,
      token: record.token,
      principal_id: record.principalId,
      principal_kind: record.principalKind,
      principal_member_ref: record.principalMemberRef,
      active_role: record.activeRole,
      issued_at: record.issuedAt,
      expires_at: record.expiresAt,
      last_seen_at: record.lastSeenAt,
      revoked_at: record.revokedAt,
      issuer: record.issuer,
    });
  }

  return frozen({
    putSession(
      ctx: TenantContext,
      record: SessionRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      // Token uniqueness within the tenant: two sessions must never share
      // a token (the token is the authentication lookup key).
      const byToken = store.list(ctx, "fleetos_sessions", {
        where: frozen({ ...field("token", record.token) }),
      });
      if (byToken.length > 0) {
        return { ok: false, reason: "already_exists" };
      }
      const write = store.insert(ctx, "fleetos_sessions", record.sessionId, toRow(record));
      if (!write.ok && write.reason === "already_exists") {
        return { ok: false, reason: "already_exists" };
      }
      return { ok: true };
    },
    updateSession(
      ctx: TenantContext,
      record: SessionRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const existing = store.get(ctx, "fleetos_sessions", record.sessionId);
      if (existing === undefined) {
        return { ok: false, reason: "unknown_session" };
      }
      const write = store.put(ctx, "fleetos_sessions", record.sessionId, toRow(record));
      if (!write.ok) {
        return { ok: false, reason: "unknown_session" };
      }
      return { ok: true };
    },
    getSession(ctx: TenantContext, sessionId: string): SessionRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const stored = store.get(ctx, "fleetos_sessions", sessionId);
      return stored === undefined ? undefined : toRecord(tenantId, stored);
    },
    getSessionByToken(ctx: TenantContext, token: string): SessionRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const rows = store.list(ctx, "fleetos_sessions", {
        where: frozen({ ...field("token", token) }),
      });
      const first = rows[0];
      return first === undefined ? undefined : toRecord(tenantId, first);
    },
    listSessionsForPrincipal(ctx: TenantContext, principalId: string): readonly SessionRecord[] {
      const tenantId = requireTenantContext(ctx);
      return store
        .list(ctx, "fleetos_sessions", {
          where: frozen({ ...field("principal_id", principalId) }),
        })
        .map((stored) => toRecord(tenantId, stored));
    },
    removeSession(ctx: TenantContext, sessionId: string): boolean {
      requireTenantContext(ctx);
      return store.remove(ctx, "fleetos_sessions", sessionId);
    },
  });
}

// ---------------------------------------------------------------------------
// The workspace-invitation repository
// ---------------------------------------------------------------------------

/** A persistent workspace-join invitation record. */
export interface WorkspaceInvitationRecord {
  readonly tenantId: TenantId;
  /** Deterministic invitation id (`inv_` prefix). */
  readonly invitationId: string;
  /** A deterministic hash of the join code (the raw code is never stored). */
  readonly codeHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly usedBy: string | null;
}

/** The tenant-scoped invitation repository contract. */
export interface InvitationRepository {
  /** Persist an invitation (insert; duplicate refusal on an existing id). */
  putInvitation(
    ctx: TenantContext,
    record: WorkspaceInvitationRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** One invitation by invitation id (own partition only). */
  getInvitation(ctx: TenantContext, invitationId: string): WorkspaceInvitationRecord | undefined;
  /**
   * The SYSTEM-level code resolver: an exact code-hash match across
   * tenants (join happens before the joining principal holds a tenant
   * context — see the seam docs). Returns the invitation WITH its tenant
   * scope.
   */
  findInvitationByCodeHash(codeHash: string): WorkspaceInvitationRecord | undefined;
  /** Overwrite an invitation (the used-transition). */
  updateInvitation(
    ctx: TenantContext,
    record: WorkspaceInvitationRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
}

/** Create the durable invitation repository over the seam. */
export function createDurableInvitationRepository(store: DurableRecordStore): InvitationRepository {
  function toRecord(stored: DurableStoredRow): WorkspaceInvitationRecord {
    return frozen({
      tenantId: asTenantId(text(stored.row, "tenant_id")),
      invitationId: text(stored.row, "invitation_id"),
      codeHash: text(stored.row, "code_hash"),
      createdBy: text(stored.row, "created_by"),
      createdAt: text(stored.row, "created_at"),
      expiresAt: text(stored.row, "expires_at"),
      usedAt: textOrNull(stored.row, "used_at"),
      usedBy: textOrNull(stored.row, "used_by"),
    });
  }

  function toRow(record: WorkspaceInvitationRecord): DurableRow {
    return frozen({
      tenant_id: record.tenantId,
      invitation_id: record.invitationId,
      code_hash: record.codeHash,
      created_by: record.createdBy,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      used_at: record.usedAt,
      used_by: record.usedBy,
    });
  }

  return frozen({
    putInvitation(
      ctx: TenantContext,
      record: WorkspaceInvitationRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const write = store.insert(
        ctx,
        "fleetos_workspace_invitations",
        record.invitationId,
        toRow(record),
      );
      if (!write.ok && write.reason === "already_exists") {
        return { ok: false, reason: "already_exists" };
      }
      return { ok: true };
    },
    getInvitation(ctx: TenantContext, invitationId: string): WorkspaceInvitationRecord | undefined {
      requireTenantContext(ctx);
      const stored = store.get(ctx, "fleetos_workspace_invitations", invitationId);
      return stored === undefined ? undefined : toRecord(stored);
    },
    findInvitationByCodeHash(codeHash: string): WorkspaceInvitationRecord | undefined {
      const stored = store.findInvitationByCodeHash(codeHash);
      return stored === undefined ? undefined : toRecord(stored);
    },
    updateInvitation(
      ctx: TenantContext,
      record: WorkspaceInvitationRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const existing = store.get(ctx, "fleetos_workspace_invitations", record.invitationId);
      if (existing === undefined) {
        return { ok: false, reason: "unknown_invitation" };
      }
      const write = store.put(
        ctx,
        "fleetos_workspace_invitations",
        record.invitationId,
        toRow(record),
      );
      if (!write.ok) {
        return { ok: false, reason: "unknown_invitation" };
      }
      return { ok: true };
    },
  });
}

// ---------------------------------------------------------------------------
// The password-credential repository (W121)
// ---------------------------------------------------------------------------

/**
 * A persistent password-credential record (see password.ts for the
 * seam/lifecycle rules). Carries the VERIFIER + SALT only — the plain
 * password is never stored, never returned by any projection.
 */
export interface PasswordCredentialRecord {
  readonly tenantId: TenantId;
  /** Deterministic credential id (`pwd_` prefix). */
  readonly credentialId: string;
  /** The credential's principal id (`usr:` grammar). */
  readonly principalId: string;
  /** The sign-in member reference (the member's email). */
  readonly memberRef: string;
  /** The per-credential salt (injected generator; never the plain password). */
  readonly salt: string;
  /** The PasswordHasher verifier output (the plain password is never stored). */
  readonly verifier: string;
  /** ISO 8601 credential-creation instant (injected). */
  readonly createdAt: string;
  /** The creating principal id. */
  readonly createdBy: string;
  /** ISO 8601 revocation instant, when the credential was revoked. */
  readonly revokedAt: string | null;
}

/** The tenant-scoped password-credential repository contract. */
export interface PasswordCredentialRepository {
  /** Persist a credential record (insert; duplicate refusal on an existing id). */
  putCredential(
    ctx: TenantContext,
    record: PasswordCredentialRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
  /** One credential by credential id (own partition only). */
  getCredential(ctx: TenantContext, credentialId: string): PasswordCredentialRecord | undefined;
  /** One credential by principal id (own partition only). */
  getCredentialByPrincipal(
    ctx: TenantContext,
    principalId: string,
  ): PasswordCredentialRecord | undefined;
  /** The member's credential by member reference (own partition only). */
  getCredentialByMemberRef(
    ctx: TenantContext,
    memberRef: string,
  ): PasswordCredentialRecord | undefined;
  /** Every credential in the acting tenant, credential id order. */
  listCredentials(ctx: TenantContext): readonly PasswordCredentialRecord[];
  /** Overwrite a credential record in place (lifecycle transitions only). */
  updateCredential(
    ctx: TenantContext,
    record: PasswordCredentialRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal };
}

/** The deterministic credential id: `pwd_` + tenant tail + principal. */
export function passwordCredentialIdOf(tenantId: TenantId, principalId: string): string {
  return `pwd_${tenantId.slice(4)}_${principalId.replace(/[:]/g, "-")}`;
}

/** Create the durable password-credential repository over the seam. */
export function createDurablePasswordCredentialRepository(
  store: DurableRecordStore,
): PasswordCredentialRepository {
  function toRecord(tenantId: TenantId, stored: DurableStoredRow): PasswordCredentialRecord {
    return frozen({
      tenantId,
      credentialId: text(stored.row, "credential_id"),
      principalId: text(stored.row, "principal_id"),
      memberRef: text(stored.row, "member_ref"),
      salt: text(stored.row, "salt"),
      verifier: text(stored.row, "verifier"),
      createdAt: text(stored.row, "created_at"),
      createdBy: text(stored.row, "created_by"),
      revokedAt: textOrNull(stored.row, "revoked_at"),
    });
  }

  function toRow(record: PasswordCredentialRecord): DurableRow {
    return frozen({
      tenant_id: record.tenantId,
      credential_id: record.credentialId,
      principal_id: record.principalId,
      member_ref: record.memberRef,
      salt: record.salt,
      verifier: record.verifier,
      created_at: record.createdAt,
      created_by: record.createdBy,
      revoked_at: record.revokedAt,
    });
  }

  return frozen({
    putCredential(
      ctx: TenantContext,
      record: PasswordCredentialRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const write = store.insert(
        ctx,
        "fleetos_password_credentials",
        record.credentialId,
        toRow(record),
      );
      if (!write.ok && write.reason === "already_exists") {
        return { ok: false, reason: "already_exists" };
      }
      return { ok: true };
    },
    getCredential(
      ctx: TenantContext,
      credentialId: string,
    ): PasswordCredentialRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const stored = store.get(ctx, "fleetos_password_credentials", credentialId);
      return stored === undefined ? undefined : toRecord(tenantId, stored);
    },
    getCredentialByPrincipal(
      ctx: TenantContext,
      principalId: string,
    ): PasswordCredentialRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const rows = store.list(ctx, "fleetos_password_credentials", {
        where: frozen({ ...field("principal_id", principalId) }),
      });
      const first = rows[0];
      return first === undefined ? undefined : toRecord(tenantId, first);
    },
    getCredentialByMemberRef(
      ctx: TenantContext,
      memberRef: string,
    ): PasswordCredentialRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      const rows = store.list(ctx, "fleetos_password_credentials", {
        where: frozen({ ...field("member_ref", memberRef) }),
      });
      const first = rows[0];
      return first === undefined ? undefined : toRecord(tenantId, first);
    },
    listCredentials(ctx: TenantContext): readonly PasswordCredentialRecord[] {
      const tenantId = requireTenantContext(ctx);
      return store
        .list(ctx, "fleetos_password_credentials")
        .map((stored) => toRecord(tenantId, stored));
    },
    updateCredential(
      ctx: TenantContext,
      record: PasswordCredentialRecord,
    ): { readonly ok: true } | { readonly ok: false; readonly reason: WriteRefusal } {
      const tenantId = requireTenantContext(ctx);
      if (tenantId !== record.tenantId) {
        return { ok: false, reason: "tenant_mismatch" };
      }
      const existing = store.get(ctx, "fleetos_password_credentials", record.credentialId);
      if (existing === undefined) {
        return { ok: false, reason: "unknown_credential" };
      }
      const write = store.put(ctx, "fleetos_password_credentials", record.credentialId, toRow(record));
      if (!write.ok) {
        return { ok: false, reason: "unknown_credential" };
      }
      return { ok: true };
    },
  });
}

// ---------------------------------------------------------------------------
// Principal projection helper (shared by the services)
// ---------------------------------------------------------------------------

/**
 * Rebuild a `UserPrincipal` from a session record's principal fields.
 * Pure (the constructors validate).
 *
 * @param record the session record
 * @returns the user principal
 */
export function sessionUserPrincipal(record: SessionRecord): Principal {
  return makeUserPrincipal(record.tenantId, asUserId(record.principalMemberRef));
}
