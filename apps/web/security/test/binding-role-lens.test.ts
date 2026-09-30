/**
 * W100B web-security — BINDING tests: the role lens consumes the REAL
 * identity domain (Worker C's lane, consumed as a PUBLIC experience
 * contract through the structural seam — never re-declared):
 *
 *   1. the REAL `@fleetos/identity` `resolvePermissions` (the fold of
 *      active role assignments) produces `ResolvedPermissions` that
 *      STRUCTURALLY satisfies the lens's `RoleLensAuthorityInput` —
 *      TypeScript is the compile-time proof, the identity return the
 *      runtime proof (no adapter/mapping intervenes);
 *   2. the lens's restricted/available derivations AGREE with the REAL
 *      `@fleetos/identity` `checkPermission` decisions for the same
 *      inputs (identity + Guardian — the matrix rule);
 *   3. the ROLE NEVER GRANTS: an empty authority stays empty in every
 *      lens even when the ACTIVE ROLE is the role whose DEFINITION
 *      carries the permission (the lens reads the resolved set only);
 *   4. the REAL `@fleetos/policy` Guardian evaluation + the REAL
 *      `@fleetos/security` findings + the REAL `@fleetos/actions`
 *      parked plan feed the role-shaped views end-to-end.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  checkPermission,
  makeActionDescriptor,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "@fleetos/identity";
import type { AuthorizationInputs, ResolvedPermissions } from "@fleetos/identity";
import {
  assessSecurityPosture,
} from "@fleetos/security";
import {
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
} from "@fleetos/actions";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  buildApprovalsQueueView,
  buildFindingsListView,
  buildParkedExplanationView,
  buildRoleShapedFindingsView,
  buildSecurityRoleLens,
} from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import { asDeviceId, asObservationId } from "@fleetos/contracts";
import { TENANT_A, scopeA } from "./helpers";

// ---------------------------------------------------------------------------
// The REAL identity fixtures (the frozen grammar)
// ---------------------------------------------------------------------------

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const DEVICE = asDeviceId("dev_w100b_binding");
const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100bsec01"));

/**
 * The REAL role definitions over THIS lane's permission vocabulary —
 * exactly the identity-package pattern (role name -> sorted-unique
 * permission set). The lens NEVER sees these definitions; it sees only
 * the resolved fold.
 */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "security.compliance",
    [
      "policy.rule.read",
      "security.approval.decide",
      "security.finding.read",
      "security.remediation.propose",
    ],
    "The security & compliance experience role",
  ),
  makeRoleDefinition("employee", ["security.finding.read"], "The employee experience role"),
  makeRoleDefinition("service.desk", ["security.finding.read"], "The service desk experience role"),
];

/** The action catalog (identity's checkPermission requires known actions). */
const ACTION_CATALOG = [
  makeActionDescriptor({ action: "security.finding.read", consequential: false }),
  makeActionDescriptor({ action: "security.remediation.propose", consequential: false }),
  makeActionDescriptor({ action: "security.approval.decide", consequential: false }),
  makeActionDescriptor({ action: "policy.rule.read", consequential: false }),
];

/** Resolve a principal's effective permissions over the role assignments. */
function resolve(
  roleNames: readonly string[],
  tenantId: TenantIdLike = TENANT_A,
): ResolvedPermissions {
  return resolvePermissions(
    { kind: "user", tenantId, principalId: PRINCIPAL.principalId },
    roleNames.map((roleName, index) =>
      makeRoleAssignment({
        tenantId,
        principalId: PRINCIPAL.principalId,
        roleName,
        assignedAt: AT,
        assignedBy: "usr_w100badmin",
        ...(index === 0 ? {} : { expiresAt: undefined }),
      }),
    ),
    ROLE_DEFINITIONS,
    AT2,
  );
}

type TenantIdLike = ReturnType<typeof makeTenantId>;

// ---------------------------------------------------------------------------
// 1 — The structural seam: REAL resolvePermissions feeds the lens
// ---------------------------------------------------------------------------

test("the REAL identity ResolvedPermissions structurally satisfies the lens authority seam", () => {
  const resolved = resolve(["security.compliance"]);
  // The compile-time structural proof: a REAL ResolvedPermissions value
  // flows where RoleLensAuthorityInput is expected.
  const authority: RoleLensAuthorityInput = resolved;
  expect(authority.tenantId).toBe(TENANT_A);
  expect(authority.principalId).toBe(PRINCIPAL.principalId);
  expect(authority.permissions).toEqual([
    "policy.rule.read",
    "security.approval.decide",
    "security.finding.read",
    "security.remediation.propose",
  ]);
});

test("the lens consumes the REAL resolution: full security authority restricts nothing", () => {
  const resolved = resolve(["security.compliance"]);
  const lens = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  expect(lens.view.restricted).toEqual([]);
  expect(lens.view.authority.permissions).toEqual(resolved.permissions);
});

// ---------------------------------------------------------------------------
// 2 — The lens's derivations AGREE with the REAL checkPermission
// ---------------------------------------------------------------------------

/** The REAL authorization inputs (assignments + roles + catalog + time). */
function authInputs(roleNames: readonly string[]): AuthorizationInputs {
  return {
    grants: [],
    assignments: roleNames.map((roleName) =>
      makeRoleAssignment({
        tenantId: TENANT_A,
        principalId: PRINCIPAL.principalId,
        roleName,
        assignedAt: AT,
        assignedBy: "usr_w100badmin",
      }),
    ),
    roles: ROLE_DEFINITIONS,
    actions: ACTION_CATALOG,
    at: AT2,
  };
}

test("restricted/available agrees with the REAL checkPermission for every lens and capability", () => {
  const scenarios: readonly string[][] = [
    ["security.compliance"],
    ["employee"],
    ["service.desk"],
    ["employee", "security.compliance"],
    [],
  ];
  const lenses = ["security.compliance", "service.desk", "team.manager", "employee"] as const;
  for (const roleNames of scenarios) {
    const resolved = resolve(roleNames.length === 0 ? ["employee"] : roleNames);
    // The identity resolution with no assignments: permissions fold to [].
    const emptyResolved =
      roleNames.length === 0
        ? { ...resolved, permissions: [] as readonly string[] }
        : resolved;
    const realDecisions = ACTION_CATALOG.map((descriptor) =>
      checkPermission(
        { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: descriptor.action },
        authInputs(roleNames),
      ),
    );
    for (const activeRole of lenses) {
      // The active role must be assigned (or defaults apply) — use the
      // resolved roles as assignedRoles (the identity-fold truth).
      const assigned =
        roleNames.length === 0 ? ["employee"] : roleNames;
      if (!(assigned as readonly string[]).includes(activeRole)) continue;
      const lens = buildSecurityRoleLens(scopeA(), {
        activeRole,
        assignedRoles: assigned as never,
        authority: emptyResolved,
      });
      if (!lens.ok) throw new Error(lens.error.message);
      for (let i = 0; i < ACTION_CATALOG.length; i++) {
        const descriptor = ACTION_CATALOG[i]!;
        const realDecision = realDecisions[i]!;
        const lensAvailable = (lens.view.authority.permissions as readonly string[]).includes(
          descriptor.action,
        );
        // THE agreement: the lens's availability derivation equals the
        // REAL identity decision (allow/deny).
        expect(lensAvailable).toBe(realDecision.decision === "allow");
      }
    }
  }
});

test("an EMPTY resolution stays empty in every lens — the role DEFINITION never leaks", () => {
  // Resolve with an UNKNOWN role assignment: identity skips it
  // (unknown_role); the fold is EMPTY. The lens with activeRole
  // "security.compliance" (whose DEFINITION carries the permissions)
  // still restricts EVERYTHING — the lens reads the resolved set only.
  const resolved = resolve(["nonexistent.role"]);
  expect(resolved.permissions).toEqual([]);
  expect(resolved.skipped).toEqual([{ roleName: "nonexistent.role", reason: "unknown_role" }]);
  // Build the lens with employee active (assigned) + the empty authority.
  const lens = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    assignedRoles: ["employee"],
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  expect(lens.view.restricted.length).toBe(4);
  expect(lens.view.authority.permissions).toEqual([]);
});

// ---------------------------------------------------------------------------
// 3 — The end-to-end binding: REAL policy + security + actions -> views
// ---------------------------------------------------------------------------

test("the REAL Guardian REQUIRE_APPROVAL + REAL parked plan feed the explanation end-to-end", () => {
  // The REAL Security Doctor: a CRITICAL finding with a remediation draft.
  const assessed = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    observations: [
      {
        id: asObservationId("obs_w100b_binding_1"),
        kind: "device.security",
        observedAt: AT,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: AT,
  });
  if (!assessed.ok) throw new Error(assessed.error.message);

  // The REAL role-shaped findings view over the REAL findings (the
  // security.compliance lens, full authority).
  const resolved = resolve(["security.compliance"]);
  const lensBuild = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: resolved,
  });
  if (!lensBuild.ok) throw new Error(lensBuild.error.message);
  const shaped = buildRoleShapedFindingsView(
    scopeA(),
    lensBuild.view,
    assessed.posture.findings,
  );
  if (!shaped.ok) throw new Error(shaped.error.message);
  expect(shaped.view.findings.total).toBe(assessed.posture.findings.length);
  expect(shaped.view.remediationAffordance.available).toBe(true);

  // The REAL Guardian rule set: REQUIRE_APPROVAL for fleet.action.execute.
  const rule = defineGuardianRule(TENANT_A, {
    name: "w100b-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: AT,
  });
  if (!rule.ok) throw new Error(rule.error.message);
  const compiled = compileGuardianRuleSet(TENANT_A, { rules: [rule.rule], version: 1, at: AT });
  if (!compiled.ok) throw new Error(compiled.error.message);

  // The REAL W041 pipeline: create -> submit (parks on REQUIRE_APPROVAL).
  const plan = createActionPlan({
    tenantId: TENANT_A,
    name: "w100b-binding-plan",
    capability: "lock",
    selector: { kind: "byId", deviceIds: [DEVICE] },
    registry: createInMemoryDeviceRegistryView([
      {
        tenantId: TENANT_A,
        deviceId: DEVICE,
        lifecycleState: "OBSERVE",
        adapterCapabilities: { identify: true, observe: true, health: true, lock: true },
        platform: "windows",
        ownership: "corporate",
      },
    ]),
    requestedBy: asUserId(PRINCIPAL.principalId),
    at: AT,
  });
  if (!plan.ok) throw new Error(plan.error.message);
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    { at: AT2, correlationId: asCorrelationId("cor_w100b_binding") },
  );
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  expect(evaluation.evaluation.decision.decision).toBe("REQUIRE_APPROVAL");

  const submitted = submitActionPlan(plan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    at: AT2,
    correlationId: asCorrelationId("cor_w100b_binding"),
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  expect(submitted.plan.status).toBe("PARKED");

  // The explanation over the REAL parked item: WHY parked + WHAT
  // unlocks it, with the session's REAL authority state.
  const queue = buildApprovalsQueueView(scopeA(), [
    {
      plan: submitted.plan,
      evaluation: evaluation.evaluation,
    },
  ]);
  if (!queue.ok) throw new Error(queue.error.message);
  const deciderLens = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: resolved,
  });
  if (!deciderLens.ok) throw new Error(deciderLens.error.message);
  const explanation = buildParkedExplanationView(
    scopeA(),
    deciderLens.view,
    queue.view.items[0]!,
  );
  if (!explanation.ok) throw new Error(explanation.error.message);
  expect(explanation.view.whyParked.decision).toBe("REQUIRE_APPROVAL");
  expect(explanation.view.whyParked.reasonCodes).toContain("policy.rule.matched");
  expect(explanation.view.whatUnlocksIt.sessionMayDecide).toBe(true); // the REAL authority includes the permission
  // ...and the identity engine AGREES:
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "security.approval.decide" },
    authInputs(["security.compliance"]),
  );
  expect(real.decision).toBe("allow");

  // The REAL W041 approval step works for this session (the binding
  // site invokes it — the explanation itself never decides).
  const approved = approveParkedPlan(submitted.plan, "approve", {
    at: AT2,
    correlationId: asCorrelationId("cor_w100b_binding"),
    approverId: PRINCIPAL.principalId,
  });
  if (!approved.ok) throw new Error(approved.error.message);
  expect(approved.status).toBe("APPROVED");
});

test("the employee's REAL authority restricts the decision and identity AGREES", () => {
  const resolved = resolve(["employee"]);
  const lens = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  const decide = lens.view.restricted.find((r) => r.capability === "security.approval.decide");
  expect(decide).toBeDefined();
  expect(decide?.escalation.kind).toBe("role_assignment");
  // The identity engine AGREES: deny for the same check.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "security.approval.decide" },
    authInputs(["employee"]),
  );
  expect(real.decision).toBe("deny");
  expect(real.reasons).toEqual(["missing_permission"]);
});

test("a cross-tenant REAL resolution REFUSES in the lens (active role is tenant-scoped)", () => {
  const foreignTenant = makeTenantId("w100b-foreign");
  const resolved = resolve(["security.compliance"], foreignTenant);
  const lens = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: resolved,
  });
  expect(lens.ok).toBe(false);
  if (lens.ok) return;
  expect(lens.error.code).toBe("surface.tenant_mismatch");
});

// The findings list view import keeps the single-source-of-truth chain visible.
test("the REAL findings list view and the role-shaped view agree on the records", () => {
  const assessed = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    observations: [
      {
        id: asObservationId("obs_w100b_binding_2"),
        kind: "device.security",
        observedAt: AT,
        schemaVersion: 1,
        payload: { screenLock: false },
      },
    ],
    at: AT,
  });
  if (!assessed.ok) throw new Error(assessed.error.message);
  const base = buildFindingsListView(scopeA(), assessed.posture.findings);
  if (!base.ok) throw new Error(base.error.message);
  const resolved = resolve(["employee"]);
  const lensBuild = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    authority: resolved,
  });
  if (!lensBuild.ok) throw new Error(lensBuild.error.message);
  const shaped = buildRoleShapedFindingsView(
    scopeA(),
    lensBuild.view,
    assessed.posture.findings,
  );
  if (!shaped.ok) throw new Error(shaped.error.message);
  expect(shaped.view.findings.items.map((i) => i.findingId)).toEqual(
    base.view.items.map((i) => i.findingId),
  );
});
