/**
 * W142 web-security — the gated DESTRUCTIVE CONTROLS tests.
 *
 * The SIM-B ground truth (blocker 4, security lane): the gated
 * destructive controls were INERT — clicking them yielded no
 * confirmation flow, no error, no audit entry. These tests prove the
 * confirmation flow is REAL, explicit and audited, with the user NEVER
 * left to infer that a click failed.
 *
 * The machine proof:
 *
 *   1. The AUTHORIZATION GATE: an unauthorized attempt (a restricted
 *      role) gets an EXPLICIT denial — never a silent no-op. The state
 *      becomes `refused` with the machine-stable
 *      `authorization_required` reason and the escalation path.
 *   2. The CONFIRMATION GATES: the dispatch step REFUSES without the
 *      acknowledged consequences AND the exact typed phrase. Each
 *      refusal is machine-stable.
 *   3. The DISPATCH: a confirmed disable-enrollment-code / revoke-
 *      device-trust routes through the injected boundary; the state
 *      becomes `dispatched` with the boundary's own record (the
 *      visible state change); BOTH audit entries are written.
 *   4. The RBAC DENIAL at the boundary: if the boundary itself refuses
 *      authorization (a real `@fleetos/identity` resolver denial), the
 *      state becomes `refused` with the boundary's machine-stable
 *      reason — VISIBLE, never silence.
 *   5. The CANCEL path: a cancellation writes no audit entries (the
 *      audit policy: consequential events only — nothing happened).
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  DESTRUCTIVE_AUDIT_ACTIONS,
  DESTRUCTIVE_REFUSALS,
  SECURITY_PERMISSIONS,
  acknowledgeDestructiveConsequences,
  beginDestructiveConfirmation,
  canPerformDestructiveAction,
  cancelDestructiveConfirmation,
  destructiveActionPermission,
  destructiveAuthorizationRefusalExplanation,
  destructiveConfirmationFeedback,
  dispatchConfirmedDestructive,
  enterDestructiveConfirmationPhrase,
  explicitDestructiveConfirmationRefusal,
  isDestructiveExplicitConfirmationSatisfied,
  markDestructiveExplicitConfirmation,
  requiredDestructiveConfirmationPhrase,
} from "../src/index";
import type {
  AuthorityRecord,
  DestructiveConfirmationContext,
  DestructiveConfirmationState,
  GatedDestructiveBoundary,
  SecurityDecisionAuditRecord,
  SecurityDecisionAuditSink,
} from "../src/index";

const TENANT = makeTenantId("w142-destr");
const OTHER_TENANT = makeTenantId("w142-oth");
const USER = asUserId("usr_w142adm01");
const USER_RESTRICTED = asUserId("usr_w142emp01");
const ENROLLMENT_CODE = "enc_w142_code_01";
const DEVICE = "dev_w142_seca1";
const NOW = "2026-04-01T00:00:00Z";
const NOW2 = "2026-04-01T01:00:00Z";
const CORR = asCorrelationId("cor_w142_destr");

/** An admin authority (holds both destructive permissions). */
function adminAuthority(overrides: Partial<AuthorityRecord> = {}): AuthorityRecord {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    principalId: overrides.principalId ?? USER,
    permissions: overrides.permissions ?? [
      SECURITY_PERMISSIONS.disableEnrollmentCode,
      SECURITY_PERMISSIONS.revokeDeviceTrust,
    ],
    roles: overrides.roles ?? ["fleet.admin"],
  };
}

/** A restricted authority (no destructive permissions — the RBAC path). */
function restrictedAuthority(): AuthorityRecord {
  return {
    tenantId: TENANT,
    principalId: USER_RESTRICTED,
    permissions: [],
    roles: ["employee"],
  };
}

/** The disable-enrollment-code context. */
function disableContext(
  overrides: Partial<DestructiveConfirmationContext> = {},
): DestructiveConfirmationContext {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    action: overrides.action ?? "disable_enrollment_code",
    subject: overrides.subject ?? ENROLLMENT_CODE,
    by: overrides.by ?? USER,
    correlationId: overrides.correlationId ?? CORR,
  };
}

/** The revoke-device-trust context. */
function revokeContext(): DestructiveConfirmationContext {
  return disableContext({ action: "revoke_device_trust", subject: DEVICE });
}

/** A collecting audit sink (records every append for the assertions). */
function collectingSink(): SecurityDecisionAuditSink & {
  records(): readonly SecurityDecisionAuditRecord[];
} {
  const records: SecurityDecisionAuditRecord[] = [];
  return {
    append(record: SecurityDecisionAuditRecord): void {
      records.push(record);
    },
    records(): readonly SecurityDecisionAuditRecord[] {
      return records;
    },
  };
}

/** A boundary that succeeds (returns DISABLED / REVOKED). */
function successBoundary(): GatedDestructiveBoundary {
  return (input) => ({
    ok: true,
    record: {
      status: input.action === "disable_enrollment_code" ? "DISABLED" : "REVOKED",
      subject: input.subject,
      transitionedAt: input.at,
    },
  });
}

/** A boundary that refuses authorization (RBAC denial at the boundary). */
function unauthorizedBoundary(): GatedDestructiveBoundary {
  return (input) => ({
    ok: false,
    reason: DESTRUCTIVE_REFUSALS.authorizationRequired,
    message: `Principal ${input.by} lacks the "${destructiveActionPermission(input.action)}" permission.`,
  });
}

describe("W142 destructive: the AUTHORIZATION GATE — restricted roles get the explicit denial", () => {
  test("the canPerformDestructiveAction predicate reflects the matching permission", () => {
    expect(canPerformDestructiveAction("disable_enrollment_code", adminAuthority())).toBe(true);
    expect(canPerformDestructiveAction("revoke_device_trust", adminAuthority())).toBe(true);
    expect(canPerformDestructiveAction("disable_enrollment_code", restrictedAuthority())).toBe(false);
    expect(canPerformDestructiveAction("revoke_device_trust", restrictedAuthority())).toBe(false);
  });

  test("the permission name is action-derived (the frozen vocabulary)", () => {
    expect(destructiveActionPermission("disable_enrollment_code")).toBe(
      SECURITY_PERMISSIONS.disableEnrollmentCode,
    );
    expect(destructiveActionPermission("revoke_device_trust")).toBe(
      SECURITY_PERMISSIONS.revokeDeviceTrust,
    );
  });

  test("beginDestructiveConfirmation with a restricted authority refuses with authorization_required", () => {
    const state = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      restrictedAuthority(),
      NOW,
    );
    expect(state.kind).toBe("refused");
    if (state.kind !== "refused") throw new Error("unreachable");
    expect(state.reason).toBe(DESTRUCTIVE_REFUSALS.authorizationRequired);
    // The explanation carries the matching permission + the escalation path.
    expect(state.explanation).toContain(SECURITY_PERMISSIONS.disableEnrollmentCode);
    expect(state.explanation).toContain("Fleet Administrator");
  });

  test("the revoke-device-trust refusal carries the revoke permission name", () => {
    const state = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      revokeContext(),
      restrictedAuthority(),
      NOW,
    );
    expect(state.kind).toBe("refused");
    if (state.kind !== "refused") throw new Error("unreachable");
    expect(state.explanation).toContain(SECURITY_PERMISSIONS.revokeDeviceTrust);
  });

  test("the authorization refusal explanation echoes the active roles", () => {
    const explanation = destructiveAuthorizationRefusalExplanation(
      "disable_enrollment_code",
      restrictedAuthority(),
    );
    expect(explanation).toContain("employee");
  });

  test("a tenant scope mismatch refuses the open (fail-closed)", () => {
    const state = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: OTHER_TENANT }, // the acting scope is OTHER_TENANT
      disableContext({ tenantId: TENANT }),
      adminAuthority({ tenantId: OTHER_TENANT }),
      NOW,
    );
    // The state stays idle (the scope guard refused the open).
    expect(state.kind).toBe("idle");
  });
});

describe("W142 destructive: the CONFIRMATION GATES — never one-click", () => {
  test("the required phrase is `CONFIRM <ACTION> <subject>` — the dialog displays it", () => {
    expect(requiredDestructiveConfirmationPhrase(disableContext())).toBe(
      "CONFIRM DISABLE_ENROLLMENT_CODE enc_w142_code_01",
    );
    expect(requiredDestructiveConfirmationPhrase(revokeContext())).toBe(
      "CONFIRM REVOKE_DEVICE_TRUST dev_w142_seca1",
    );
  });

  test("an open confirmation starts in reviewing with acknowledged=false and an empty phrase", () => {
    const state = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      adminAuthority(),
      NOW,
    );
    expect(state.kind).toBe("reviewing");
    if (state.kind !== "reviewing") throw new Error("unreachable");
    expect(state.acknowledged).toBe(false);
    expect(state.phrase).toBe("");
  });

  test("dispatch without acknowledgement refuses with consequences_not_acknowledged", () => {
    const state = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      adminAuthority(),
      NOW,
    );
    const result = dispatchConfirmedDestructive(state, {
      at: NOW2,
      boundary: successBoundary(),
    });
    expect(result.state.kind).toBe("reviewing");
    expect(result.refusal?.reason).toBe(DESTRUCTIVE_REFUSALS.consequencesNotAcknowledged);
  });

  test("dispatch with acknowledgement but wrong phrase refuses with phrase_mismatch", () => {
    let state: DestructiveConfirmationState = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      adminAuthority(),
      NOW,
    );
    state = acknowledgeDestructiveConsequences(state);
    state = enterDestructiveConfirmationPhrase(state, "WRONG PHRASE");
    const result = dispatchConfirmedDestructive(state, {
      at: NOW2,
      boundary: successBoundary(),
    });
    expect(result.state.kind).toBe("reviewing");
    expect(result.refusal?.reason).toBe(DESTRUCTIVE_REFUSALS.phraseMismatch);
  });

  test("the mark refuses without the acknowledged consequences AND the exact phrase", () => {
    let state: DestructiveConfirmationState = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      adminAuthority(),
      NOW,
    );
    // No acknowledgement, no phrase — the mark is a stable no-op.
    const unmarked = markDestructiveExplicitConfirmation(state, NOW2);
    expect(unmarked.kind).toBe("reviewing");
    // Acknowledgement only — still not satisfied.
    state = { kind: "reviewing", context: disableContext(), authority: adminAuthority(), openedAt: NOW, acknowledged: true, phrase: "" };
    const ackOnly = markDestructiveExplicitConfirmation(state, NOW2);
    expect(ackOnly.kind).toBe("reviewing");
    // Wrong phrase — still not satisfied.
    state = { kind: "reviewing", context: disableContext(), authority: adminAuthority(), openedAt: NOW, acknowledged: true, phrase: "WRONG" };
    const wrongPhrase = markDestructiveExplicitConfirmation(state, NOW2);
    expect(wrongPhrase.kind).toBe("reviewing");
    // Correct phrase — the mark transitions to ready_to_dispatch.
    state = { kind: "reviewing", context: disableContext(), authority: adminAuthority(), openedAt: NOW, acknowledged: true, phrase: requiredDestructiveConfirmationPhrase(disableContext()) };
    const marked = markDestructiveExplicitConfirmation(state, NOW2);
    expect(marked.kind).toBe("ready_to_dispatch");
  });

  test("isDestructiveExplicitConfirmationSatisfied is the gate's own check", () => {
    const satisfied: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: true,
      phrase: requiredDestructiveConfirmationPhrase(disableContext()),
    };
    expect(isDestructiveExplicitConfirmationSatisfied(satisfied)).toBe(true);
    const unsatisfied: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: false,
      phrase: "",
    };
    expect(isDestructiveExplicitConfirmationSatisfied(unsatisfied)).toBe(false);
  });
});

describe("W142 destructive: the DISPATCH — the boundary's record is the visible state change", () => {
  test("disable_enrollment_code routes through the boundary and writes BOTH audit entries", () => {
    const sink = collectingSink();
    const state: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: true,
      phrase: requiredDestructiveConfirmationPhrase(disableContext()),
    };
    const marked = markDestructiveExplicitConfirmation(state, NOW2);
    expect(marked.kind).toBe("ready_to_dispatch");
    const result = dispatchConfirmedDestructive(marked, {
      at: NOW2,
      boundary: successBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("dispatched");
    if (result.state.kind !== "dispatched") throw new Error("unreachable");
    expect(result.state.status).toBe("DISABLED");
    expect(result.state.subject).toBe(ENROLLMENT_CODE);
    expect(result.refusal).toBeUndefined();
    // BOTH audit entries were written.
    const records = sink.records();
    expect(records.length).toBe(2);
    expect(records[0]?.action).toBe(DESTRUCTIVE_AUDIT_ACTIONS.explicitConfirmation);
    expect(records[0]?.subject).toBe(ENROLLMENT_CODE);
    expect(records[1]?.action).toBe(DESTRUCTIVE_AUDIT_ACTIONS.dispatched);
    expect(records[1]?.details.status).toBe("DISABLED");
  });

  test("revoke_device_trust routes through the boundary with the device subject", () => {
    const sink = collectingSink();
    const state: DestructiveConfirmationState = {
      kind: "reviewing",
      context: revokeContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: true,
      phrase: requiredDestructiveConfirmationPhrase(revokeContext()),
    };
    const marked = markDestructiveExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedDestructive(marked, {
      at: NOW2,
      boundary: successBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("dispatched");
    if (result.state.kind !== "dispatched") throw new Error("unreachable");
    expect(result.state.status).toBe("REVOKED");
    expect(result.state.subject).toBe(DEVICE);
    expect(sink.records()[1]?.details.status).toBe("REVOKED");
  });
});

describe("W142 destructive: the RBAC DENIAL at the boundary — visible, never silence", () => {
  test("an unauthorized boundary (the REAL identity resolver denial) surfaces the refused state", () => {
    const sink = collectingSink();
    // The operator has the permission in the surface authority (the
    // local check passes), but the boundary's REAL identity resolver
    // denies the permission (e.g. the role assignment was revoked
    // between the open and the dispatch). The boundary's refusal
    // becomes a VISIBLE refused state — never a silent no-op.
    const state: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(), // the surface authority passes
      openedAt: NOW,
      acknowledged: true,
      phrase: requiredDestructiveConfirmationPhrase(disableContext()),
    };
    const marked = markDestructiveExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedDestructive(marked, {
      at: NOW2,
      boundary: unauthorizedBoundary(), // the REAL boundary denies
      auditSink: sink,
    });
    expect(result.state.kind).toBe("refused");
    if (result.state.kind !== "refused") throw new Error("unreachable");
    expect(result.state.reason).toBe(DESTRUCTIVE_REFUSALS.authorizationRequired);
    expect(result.state.explanation).toContain(SECURITY_PERMISSIONS.disableEnrollmentCode);
    // The explicit-confirmation entry WAS written (the gate was passed);
    // the dispatch entry was NOT (the boundary refused).
    expect(sink.records().length).toBe(1);
    expect(sink.records()[0]?.action).toBe(DESTRUCTIVE_AUDIT_ACTIONS.explicitConfirmation);
  });
});

describe("W142 destructive: never auto-promoted — no path executes without the explicit confirmation", () => {
  test("the idle state refuses the dispatch with no_confirmation_open", () => {
    const result = dispatchConfirmedDestructive(
      { kind: "idle" } as DestructiveConfirmationState,
      { at: NOW2, boundary: successBoundary() },
    );
    expect(result.state.kind).toBe("idle");
    expect(result.refusal?.reason).toBe(DESTRUCTIVE_REFUSALS.noConfirmationOpen);
  });

  test("the reviewing state (acknowledged + matching phrase, but no mark) refuses with explicit_confirmation_required", () => {
    const state: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: true,
      phrase: requiredDestructiveConfirmationPhrase(disableContext()),
    };
    const result = dispatchConfirmedDestructive(state, {
      at: NOW2,
      boundary: successBoundary(),
    });
    expect(result.state.kind).toBe("reviewing");
    expect(result.refusal?.reason).toBe(DESTRUCTIVE_REFUSALS.explicitConfirmationRequired);
  });

  test("the explicit-confirmation refusal for a dispatched state surfaces no_confirmation_open", () => {
    const dispatched: DestructiveConfirmationState = {
      kind: "dispatched",
      context: disableContext(),
      authority: adminAuthority(),
      status: "DISABLED",
      subject: ENROLLMENT_CODE,
      at: NOW2,
    };
    const refusal = explicitDestructiveConfirmationRefusal(dispatched);
    expect(refusal.reason).toBe(DESTRUCTIVE_REFUSALS.noConfirmationOpen);
  });
});

describe("W142 destructive: the CANCEL path — the operator backed out (visible, no audit)", () => {
  test("a reviewing state cancels to cancelled (no audit entries written)", () => {
    const sink = collectingSink();
    let state: DestructiveConfirmationState = beginDestructiveConfirmation(
      { kind: "idle" } as DestructiveConfirmationState,
      { tenantId: TENANT },
      disableContext(),
      adminAuthority(),
      NOW,
    );
    state = cancelDestructiveConfirmation(state, NOW2);
    expect(state.kind).toBe("cancelled");
    // The dispatch on a cancelled state refuses; no audit entries.
    const result = dispatchConfirmedDestructive(state, {
      at: NOW2,
      boundary: successBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("cancelled");
    expect(sink.records().length).toBe(0);
  });
});

describe("W142 destructive: the FEEDBACK projection — the user is never left to infer a click failed", () => {
  test("every state carries a machine-stable feedback line", () => {
    const idle: DestructiveConfirmationState = { kind: "idle" };
    expect(destructiveConfirmationFeedback(idle).status).toBe("idle");
    const reviewing: DestructiveConfirmationState = {
      kind: "reviewing",
      context: disableContext(),
      authority: adminAuthority(),
      openedAt: NOW,
      acknowledged: false,
      phrase: "",
    };
    expect(destructiveConfirmationFeedback(reviewing).status).toBe("reviewing");
    const refused: DestructiveConfirmationState = {
      kind: "refused",
      context: disableContext(),
      authority: restrictedAuthority(),
      reason: DESTRUCTIVE_REFUSALS.authorizationRequired,
      explanation: "denied",
      at: NOW,
    };
    expect(destructiveConfirmationFeedback(refused).status).toBe("refused");
    const dispatched: DestructiveConfirmationState = {
      kind: "dispatched",
      context: disableContext(),
      authority: adminAuthority(),
      status: "DISABLED",
      subject: ENROLLMENT_CODE,
      at: NOW2,
    };
    const feedback = destructiveConfirmationFeedback(dispatched);
    expect(feedback.status).toBe("dispatched");
    expect(feedback.message).toContain("DISABLED");
    expect(feedback.message).toContain(ENROLLMENT_CODE);
  });
});
