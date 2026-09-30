/**
 * @fleetos/identity — the workspace/tenant create/join lifecycle (W100C D2).
 *
 * The durable lifecycle behind "a user can create or join a workspace
 * and see the active tenant context" (PRODUCT-READINESS-AUDIT gap #1):
 *
 *   CREATE: a founder creates a workspace -> a new tenant is minted ->
 *   the founder's principal + initial role assignments are persisted ->
 *   audited (`identity.workspace.created`).
 *
 *   JOIN:   an invited user redeems a join code -> the invitation is
 *   resolved (SYSTEM-level code-hash lookup — join happens BEFORE the
 *   joining principal holds a tenant context) -> validated (unused,
 *   unexpired — fail-closed on unparseable expiry) -> the joining
 *   principal + default role assignments are persisted in the TARGET
 *   tenant -> the invitation is marked used -> audited
 *   (`identity.workspace.joined`) in the TARGET tenant's scope.
 *
 * Determinism: every timestamp is injected; ids and codes come from
 * INJECTED generators (deterministic defaults); the same inputs produce
 * byte-identical records. The audit trail receives one record per
 * consequential transition (append-only sink).
 *
 * Tenant isolation: the join writes execute with the TARGET tenant's
 * context (resolved from the invitation — never caller-supplied), and
 * every repository operation partitions by that context. A caller can
 * never join "into" a tenant it names itself; the CODE names the tenant.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId, UserId } from "@fleetos/contracts";
import { asTenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { TenantContext } from "./tenant-context";
import { makeTenantContext } from "./tenant-context";
import { makeUserPrincipal } from "./principal";
import type { RoleAssignment } from "./roles";
import { makeRoleAssignment } from "./roles";
import type {
  InvitationRepository,
  PrincipalRepository,
  RoleAssignmentRepository,
  TenantRepository,
  WorkspaceInvitationRecord,
  WorkspaceRecord,
} from "./durable/repositories";
import type { IdentityAuditSink } from "./identity-audit-seam";
import { IDENTITY_AUDIT_ACTIONS, NOOP_IDENTITY_AUDIT_SINK } from "./identity-audit-seam";

// ---------------------------------------------------------------------------
// Generator seams (injected — deterministic defaults)
// ---------------------------------------------------------------------------

/** Generates a fresh tenant id (must satisfy the frozen tnt_ grammar). */
export type TenantIdGenerator = () => TenantId;

/** Generates a fresh join code (opaque, single-use). */
export type JoinCodeGenerator = () => string;

/** Options for the deterministic reference generators. */
export interface WorkspaceGeneratorOptions {
  /** Tenant-id generator (default: deterministic `tnt_w<zero-padded n>`). */
  readonly tenantId?: TenantIdGenerator;
  /** Join-code generator (default: deterministic 12-char base32). */
  readonly joinCode?: JoinCodeGenerator;
}

/** Create the deterministic reference generators. */
function createReferenceGenerators(opts: WorkspaceGeneratorOptions): {
  readonly tenantId: TenantIdGenerator;
  readonly joinCode: JoinCodeGenerator;
} {
  let tenantCounter = 0;
  let codeCounter = 0;
  const tenantId: TenantIdGenerator =
    opts.tenantId ??
    (() => {
      tenantCounter += 1;
      return asTenantId(`tnt_w${String(tenantCounter).padStart(9, "0")}`);
    });
  const joinCode: JoinCodeGenerator =
    opts.joinCode ??
    (() => {
      codeCounter += 1;
      return `join${String(codeCounter).padStart(8, "0")}`;
    });
  return { tenantId, joinCode };
}

// ---------------------------------------------------------------------------
// Inputs / results
// ---------------------------------------------------------------------------

/** The input of `createWorkspace`. */
export interface CreateWorkspaceInput {
  /** The injected creation instant (no clock reads). */
  readonly now: string;
  /** The workspace display name (non-empty). */
  readonly name: string;
  /** The founding user. */
  readonly founderUserId: UserId;
  /** The founder's display name. */
  readonly founderDisplayName: string;
  /**
   * The founder's initial roles (non-empty; each becomes a persisted
   * assignment in the new tenant).
   */
  readonly initialRoles: readonly string[];
  readonly correlationId: CorrelationId;
}

/** The input of `createInvitation`. */
export interface CreateInvitationInput {
  /** The injected issuance instant. */
  readonly now: string;
  /** The invitation's lifetime in seconds (positive integer). */
  readonly ttlSeconds: number;
  /** The inviting principal id. */
  readonly createdBy: string;
  readonly correlationId: CorrelationId;
}

/** The input of `joinWorkspace`. */
export interface JoinWorkspaceInput {
  /** The injected join instant. */
  readonly now: string;
  /** The raw join code as entered by the joining user. */
  readonly code: string;
  /** The joining user. */
  readonly userId: UserId;
  /** The joining user's display name. */
  readonly displayName: string;
  /**
   * The roles granted on join (non-empty; default vocabulary is a
   * caller decision — the service never invents roles).
   */
  readonly roles: readonly string[];
  readonly correlationId: CorrelationId;
}

/** The durable outcome of a workspace lifecycle transition. */
export interface WorkspaceLifecycleResult {
  readonly ok: true;
  /** The affected tenant (created or joined). */
  readonly tenantId: TenantId;
  /** The workspace record. */
  readonly workspace: WorkspaceRecord;
  /** The acting user's principal membership in the tenant. */
  readonly principalId: string;
  /** The role assignments granted by the transition. */
  readonly assignments: readonly RoleAssignment[];
  /** The invitation, when one was involved (join). */
  readonly invitation: WorkspaceInvitationRecord | null;
}

/** The machine-stable refusal reasons of the join lifecycle. */
export type JoinRefusal =
  | "invitation_unknown"
  | "invitation_expired"
  | "invitation_already_used"
  | "membership_already_exists"
  | "invalid_input";

/** The tagged result of a join attempt. */
export type JoinResult =
  | WorkspaceLifecycleResult
  | {
      readonly ok: false;
      readonly reason: JoinRefusal;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The injected dependencies of the workspace lifecycle service. */
export interface WorkspaceServiceDeps {
  readonly tenants: TenantRepository;
  readonly principals: PrincipalRepository;
  readonly assignments: RoleAssignmentRepository;
  readonly invitations: InvitationRepository;
  /** The audit sink (append-only). */
  readonly auditSink?: IdentityAuditSink;
  /** The generators (deterministic defaults). */
  readonly generators?: WorkspaceGeneratorOptions;
}

/** The invitation view returned to the inviter (the RAW CODE is visible exactly once). */
export interface IssuedInvitation {
  readonly invitation: WorkspaceInvitationRecord;
  /** The raw join code — shown to the inviter once; only the hash is stored. */
  readonly rawCode: string;
}

/** The default join-code hash (deterministic, non-cryptographic — production injects SHA-256). */
export function joinCodeHash(code: string): string {
  // FNV-1a over the code (the audit lane's reference-hash discipline).
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `jch_${hash.toString(16).padStart(8, "0")}`;
}

/** The deterministic invitation id: `inv_` + tenant tail + code hash. */
function invitationIdOf(tenantId: TenantId, codeHash: string): string {
  return `inv_${tenantId.slice(4)}_${codeHash.slice(4)}`;
}

/** Parse an ISO 8601 instant; undefined when unparseable (fail-closed). */
function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Create the workspace lifecycle service.
 *
 * @param deps the injected repositories + audit sink + generators
 * @returns the frozen service
 */
export function createWorkspaceLifecycleService(deps: WorkspaceServiceDeps) {
  const audit: IdentityAuditSink = deps.auditSink ?? NOOP_IDENTITY_AUDIT_SINK;
  const generators = createReferenceGenerators(deps.generators ?? {});

  return frozen({
    /**
     * CREATE a workspace: mint the tenant, persist the founder's
     * principal and initial role assignments, audit the transition.
     * Deterministic; every timestamp injected.
     */
    createWorkspace(input: CreateWorkspaceInput): WorkspaceLifecycleResult {
      const tenantId = generators.tenantId();
      const ctx = makeTenantContext(tenantId, input.correlationId);
      const founder = makeUserPrincipal(tenantId, input.founderUserId);

      const workspace: WorkspaceRecord = frozen({
        tenantId,
        name: input.name,
        status: "active",
        createdAt: input.now,
        createdBy: founder.principalId,
      });
      const tenantsPut = deps.tenants.putWorkspace(ctx, workspace);
      if (!tenantsPut.ok) {
        throw new Error(
          `createWorkspace: tenant id collision for ${tenantId} (regenerate the tenant-id generator sequence)`,
        );
      }

      const membershipPut = deps.principals.putPrincipal(ctx, {
        tenantId,
        principalId: founder.principalId,
        kind: "user",
        memberRef: input.founderUserId,
        displayName: input.founderDisplayName,
        createdAt: input.now,
      });
      if (!membershipPut.ok) {
        throw new Error(
          `createWorkspace: founder principal collision for ${founder.principalId}`,
        );
      }

      const assignments: RoleAssignment[] = [];
      for (const roleName of [...new Set(input.initialRoles)].sort()) {
        const assignment = makeRoleAssignment({
          tenantId,
          principalId: founder.principalId,
          roleName,
          assignedAt: input.now,
          assignedBy: founder.principalId,
        });
        const added = deps.assignments.addAssignment(ctx, assignment);
        if (!added.ok) {
          throw new Error(`createWorkspace: role assignment failed for ${roleName}`);
        }
        assignments.push(assignment);
      }

      audit.append({
        tenantId,
        action: IDENTITY_AUDIT_ACTIONS.workspaceCreated,
        subject: tenantId,
        actorPrincipalId: founder.principalId,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          workspaceName: input.name,
          founderPrincipalId: founder.principalId,
          initialRoles: [...new Set(input.initialRoles)].sort(),
        },
      });

      return frozen({
        ok: true,
        tenantId,
        workspace,
        principalId: founder.principalId,
        assignments: Object.freeze(assignments),
        invitation: null,
      });
    },

    /**
     * ISSUE a join invitation for the ACTING tenant. The raw code is
     * returned exactly once; only its deterministic hash is persisted.
     */
    createInvitation(
      ctx: TenantContext,
      input: CreateInvitationInput,
    ): { readonly ok: true; readonly issued: IssuedInvitation } | { readonly ok: false; readonly message: string } {
      const tenantId = ctx.tenantId;
      const rawCode = generators.joinCode();
      const codeHash = joinCodeHash(rawCode);
      const invitation: WorkspaceInvitationRecord = frozen({
        tenantId,
        invitationId: invitationIdOf(tenantId, codeHash),
        codeHash,
        createdBy: input.createdBy,
        createdAt: input.now,
        expiresAt: new Date(
          (parseIsoMs(input.now) ?? 0) + input.ttlSeconds * 1000,
        ).toISOString(),
        usedAt: null,
        usedBy: null,
      });
      const put = deps.invitations.putInvitation(ctx, invitation);
      if (!put.ok) {
        return { ok: false, message: "invitation id collision (regenerate the code sequence)" };
      }
      audit.append({
        tenantId,
        action: IDENTITY_AUDIT_ACTIONS.invitationCreated,
        subject: invitation.invitationId,
        actorPrincipalId: input.createdBy,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          invitationId: invitation.invitationId,
          ttlSeconds: input.ttlSeconds,
        },
      });
      return { ok: true, issued: frozen({ invitation, rawCode }) };
    },

    /**
     * JOIN a workspace by redeeming a join code. The invitation resolves
     * the TARGET tenant (never caller-supplied); validation is
     * fail-closed (unparseable expiry = expired); the joining principal
     * and role assignments persist in the TARGET tenant's scope; the
     * invitation is marked used; the transition is audited in the target
     * tenant. A role switch never happens here and the tenant is never
     * caller-controlled.
     */
    joinWorkspace(input: JoinWorkspaceInput): JoinResult {
      if (typeof input.code !== "string" || input.code.length === 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "joinWorkspace: a non-empty join code is required",
        };
      }
      if (input.roles.length === 0) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "joinWorkspace: at least one join role is required",
        };
      }
      const nowMs = parseIsoMs(input.now);
      if (nowMs === undefined) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "joinWorkspace: `now` must be a parseable ISO 8601 instant",
        };
      }

      const invitation = deps.invitations.findInvitationByCodeHash(joinCodeHash(input.code));
      if (invitation === undefined) {
        return {
          ok: false,
          reason: "invitation_unknown",
          message: "joinWorkspace: no invitation matches this code",
        };
      }
      // Fail-closed: an unparseable invitation expiry treats the
      // invitation as expired (a malformed time box never widens access).
      const expiryMs = parseIsoMs(invitation.expiresAt);
      if (expiryMs === undefined || nowMs >= expiryMs) {
        return {
          ok: false,
          reason: "invitation_expired",
          message: "joinWorkspace: the invitation is expired (fail-closed on malformed expiry)",
        };
      }
      if (invitation.usedAt !== null) {
        return {
          ok: false,
          reason: "invitation_already_used",
          message: "joinWorkspace: the invitation code was already redeemed",
        };
      }

      // The TARGET tenant context — resolved FROM the invitation, never
      // from the caller. Every write below partitions by this scope.
      const tenantId = invitation.tenantId;
      const ctx = makeTenantContext(tenantId, input.correlationId);
      const joiner = makeUserPrincipal(tenantId, input.userId);

      // Membership idempotency: a principal already in the tenant refuses
      // the join (the invitation stays unused — no burn on refusal).
      const existing = deps.principals.getPrincipal(ctx, joiner.principalId);
      if (existing !== undefined) {
        return {
          ok: false,
          reason: "membership_already_exists",
          message: `joinWorkspace: principal ${joiner.principalId} already belongs to tenant ${tenantId}`,
        };
      }

      const membershipPut = deps.principals.putPrincipal(ctx, {
        tenantId,
        principalId: joiner.principalId,
        kind: "user",
        memberRef: input.userId,
        displayName: input.displayName,
        createdAt: input.now,
      });
      if (!membershipPut.ok) {
        return {
          ok: false,
          reason: "membership_already_exists",
          message: `joinWorkspace: principal ${joiner.principalId} already belongs to tenant ${tenantId}`,
        };
      }

      const assignments: RoleAssignment[] = [];
      for (const roleName of [...new Set(input.roles)].sort()) {
        const assignment = makeRoleAssignment({
          tenantId,
          principalId: joiner.principalId,
          roleName,
          assignedAt: input.now,
          assignedBy: invitation.createdBy,
        });
        const added = deps.assignments.addAssignment(ctx, assignment);
        if (!added.ok) {
          return {
            ok: false,
            reason: "invalid_input",
            message: `joinWorkspace: role assignment failed for ${roleName}`,
          };
        }
        assignments.push(assignment);
      }

      // Mark the invitation used (single-use) — AFTER the membership
      // writes so a failed join never burns the code.
      const used: WorkspaceInvitationRecord = frozen({
        ...invitation,
        usedAt: input.now,
        usedBy: joiner.principalId,
      });
      const updated = deps.invitations.updateInvitation(ctx, used);
      if (!updated.ok) {
        return {
          ok: false,
          reason: "invitation_unknown",
          message: "joinWorkspace: the invitation disappeared before redemption completed",
        };
      }

      const workspace = deps.tenants.getWorkspace(ctx);
      if (workspace === undefined) {
        return {
          ok: false,
          reason: "invitation_unknown",
          message: `joinWorkspace: the invitation's tenant ${tenantId} has no workspace record`,
        };
      }

      audit.append({
        tenantId,
        action: IDENTITY_AUDIT_ACTIONS.workspaceJoined,
        subject: invitation.invitationId,
        actorPrincipalId: joiner.principalId,
        occurredAt: input.now,
        correlationId: input.correlationId,
        details: {
          invitationId: invitation.invitationId,
          joinedPrincipalId: joiner.principalId,
          grantedRoles: [...new Set(input.roles)].sort(),
        },
      });

      return frozen({
        ok: true,
        tenantId,
        workspace,
        principalId: joiner.principalId,
        assignments: Object.freeze(assignments),
        invitation: used,
      });
    },
  });
}
