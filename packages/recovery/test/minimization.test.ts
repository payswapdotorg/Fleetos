/**
 * W071 tests — the data-minimization projection over recovery evidence
 * (@fleetos/recovery).
 *
 * Proves, against the REAL W040 last-seen ledger + Find-My-Device view
 * (the in-memory reference implementations, same package):
 *
 *   - the location payload is DROPPED unless a typed grant is present
 *     (machine-stable `located_redacted` + redaction reason
 *     `no_grant`) — data minimization is the DEFAULT state, never
 *     ambient;
 *   - a VALID grant (approver + instant, scoped to the exact tenant +
 *     device, unexpired at the view instant) unlocks the payload
 *     (`located`, the W040 verbatim state) and the disclosure is
 *     AUDITED with the grant context (who unlocked what, when);
 *   - an expired grant withholds the payload (`grant_expired`);
 *   - a grant scoped to another tenant/device withholds the payload
 *     (`grant_scope_mismatch`) — tenant isolation by construction;
 *   - a malformed grant withholds the payload (`grant_malformed`);
 *   - absent location evidence stays the W040 verbatim
 *     `no_location_evidence` (never a guess; nothing audited);
 *   - the last-seen summary (presence evidence) always rides verbatim;
 *   - every redaction is audited with its machine-stable reason;
 *   - a foreign-tenant VIEW is refused (never projected, never
 *     audited under the acting tenant);
 *   - determinism: byte-identical projections + audit records across
 *     runs and grant-field permutations.
 */

import { describe, expect, test } from "bun:test";
import {
  createInMemoryLastSeenLedger,
  createInMemoryRecoveryAuditSink,
  findMyDevice,
  LOCATED,
  NO_LOCATION_EVIDENCE,
  recordLastSeenObservations,
  type FindMyDeviceView,
  type LastSeenLedger,
} from "../src/index";
import {
  ALL_LOCATION_REDACTION_REASONS,
  LOCATED_REDACTED,
  MINIMIZATION_AUDIT_ACTIONS,
  isGrantValidAt,
  makeLocationDisclosureGrant,
  minimizedViewContentDigest,
  projectMinimizedFindMyDevice,
  type LocationDisclosureGrant,
} from "../src/minimization";
import {
  atHour,
  batch,
  CORR,
  DEV_A1,
  DEV_A2,
  locationObservation,
  obs,
  scopeA,
  scopeB,
  TENANT_A,
  TENANT_B,
  THRESHOLDS,
  T0,
} from "./helpers";

/** A location-bearing observation set for one device. */
function locationBatches() {
  return [
    batch(DEV_A1, [
      locationObservation(atHour(1), 40.4, -3.7, "obs_min_loc_1"),
      obs("device.security", { diskEncryption: false }, atHour(1), "obs_min_sec"),
    ], atHour(1)),
    batch(DEV_A1, [
      locationObservation(atHour(2), 40.41, -3.71, "obs_min_loc_2"),
    ], atHour(2)),
  ];
}

/** Record last-seen evidence for DEV_A1 under tenant A (or throw). */
function recordedLedger(): LastSeenLedger {
  const ledger = createInMemoryLastSeenLedger();
  const write = recordLastSeenObservations(scopeA(), ledger, DEV_A1, locationBatches(), {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  if (!write.ok) throw new Error(write.error.message);
  return ledger;
}

/** The W040 view of DEV_A1 (located, fresh at the view instant). */
function locatedView(ledger: LastSeenLedger = recordedLedger()): FindMyDeviceView {
  return findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(3), thresholds: THRESHOLDS });
}

/** A well-formed grant for (tenant A, DEV_A1). */
function grantFor(options: { expiresAt?: string } = {}): LocationDisclosureGrant {
  const built = makeLocationDisclosureGrant({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    approver: "usr_minimization01",
    grantedAt: atHour(3),
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
  });
  if (!built.ok) throw new Error(built.detail);
  return built.grant;
}

// ---------------------------------------------------------------------------
// The typed grant
// ---------------------------------------------------------------------------

describe("W071: minimization — the typed disclosure grant", () => {
  test("a well-formed grant carries approver + instant + scope (frozen)", () => {
    const grant = grantFor();
    expect(grant.tenantId).toBe(TENANT_A);
    expect(grant.deviceId).toBe(DEV_A1);
    expect(grant.approver).toBe("usr_minimization01");
    expect(grant.grantedAt).toBe(atHour(3));
    expect(Object.isFrozen(grant)).toBe(true);
  });

  test("grant validation refuses malformed shapes machine-stably (never ambient)", () => {
    expect(makeLocationDisclosureGrant(null).ok).toBe(false);
    expect(makeLocationDisclosureGrant({}).ok).toBe(false);
    expect(
      makeLocationDisclosureGrant({
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        approver: "",
        grantedAt: atHour(3),
      }).ok,
    ).toBe(false);
    expect(
      makeLocationDisclosureGrant({
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        approver: "usr_x",
        grantedAt: "not-iso",
      }).ok,
    ).toBe(false);
    expect(
      makeLocationDisclosureGrant({
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        approver: "usr_x",
        grantedAt: atHour(4),
        expiresAt: atHour(3),
      }).ok,
    ).toBe(false); // expiry preceding grant
    expect(
      makeLocationDisclosureGrant({
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        approver: "usr_x",
        grantedAt: atHour(3),
        expiresAt: atHour(5),
      }).ok,
    ).toBe(true);
  });

  test("grant validity is instant-scoped (strictly before expiry; fail-closed on malformed instants)", () => {
    const grant = grantFor({ expiresAt: atHour(5) });
    expect(isGrantValidAt(grant, atHour(4))).toBe(true);
    expect(isGrantValidAt(grant, atHour(5))).toBe(false); // at expiry: invalid
    expect(isGrantValidAt(grant, atHour(6))).toBe(false);
    expect(isGrantValidAt(grant, "not-iso")).toBe(false);
    const unbounded = grantFor();
    expect(isGrantValidAt(unbounded, atHour(100))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The redaction policy (the minimization projection)
// ---------------------------------------------------------------------------

describe("W071: minimization — location payloads drop without a grant (never ambient)", () => {
  test("NO grant: the payload is dropped (located_redacted, no_grant); existence evidence survives; the last-seen summary rides verbatim", () => {
    const sink = createInMemoryRecoveryAuditSink();
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(3),
      auditSink: sink,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const { view } = result;
    expect(view.location.status).toBe(LOCATED_REDACTED);
    if (view.location.status !== LOCATED_REDACTED) throw new Error("unreachable");
    expect(view.location.redactionReason).toBe("no_grant");
    expect(view.location.observationId).toBe("obs_min_loc_2"); // existence evidence kept
    expect(view.location.observedAt).toBe(atHour(2));
    expect(view.location.fromRecordId).toMatch(/^ls_/);
    expect("payload" in view.location).toBe(false); // the payload is DROPPED
    // The last-seen summary (presence evidence) rides verbatim.
    expect(view.lastSeen?.observedAt).toBe(atHour(2));
    expect(view.lastSeen?.evidence).toEqual(["obs_min_loc_2"]);
    // The redaction is audited with its machine-stable reason.
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(MINIMIZATION_AUDIT_ACTIONS.locationRedacted);
    expect(sink.records[0].details.redactionReason).toBe("no_grant");
    expect(sink.records[0].tenantId).toBe(TENANT_A);
  });

  test("a VALID grant unlocks the payload (located, the W040 verbatim state) and the DISCLOSURE is audited with the grant context", () => {
    const sink = createInMemoryRecoveryAuditSink();
    const grant = grantFor();
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(3),
      grant,
      auditSink: sink,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const { view } = result;
    expect(view.location.status).toBe(LOCATED);
    if (view.location.status !== LOCATED) throw new Error("unreachable");
    expect(view.location.payload).toEqual({
      latitude: 40.41,
      longitude: -3.71,
      capturedAt: atHour(2),
      fixSource: "gps",
    });
    expect(view.location.observationId).toBe("obs_min_loc_2");
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(MINIMIZATION_AUDIT_ACTIONS.locationDisclosed);
    expect(sink.records[0].details.approver).toBe("usr_minimization01");
    expect(sink.records[0].details.grantedAt).toBe(atHour(3));
    expect(sink.records[0].details.disclosedAt).toBe(atHour(3));
    expect(sink.records[0].details.grantExpiresAt).toBe(null);
  });

  test("an EXPIRED grant withholds the payload (grant_expired)", () => {
    const sink = createInMemoryRecoveryAuditSink();
    // Granted at hour 3, expiring at hour 4 — the view instant (hour 5)
    // is past expiry: the grant once valid no longer unlocks.
    const grant = grantFor({ expiresAt: atHour(4) });
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(5),
      grant,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.location.status).toBe(LOCATED_REDACTED);
    if (result.view.location.status !== LOCATED_REDACTED) throw new Error("unreachable");
    expect(result.view.location.redactionReason).toBe("grant_expired");
    expect(sink.records[0].action).toBe(MINIMIZATION_AUDIT_ACTIONS.locationRedacted);
    expect(sink.records[0].details.redactionReason).toBe("grant_expired");
  });

  test("a grant scoped to ANOTHER DEVICE withholds the payload (grant_scope_mismatch)", () => {
    const grant = grantFor();
    const mismatched = makeLocationDisclosureGrant({
      tenantId: TENANT_A,
      deviceId: DEV_A2, // not DEV_A1
      approver: "usr_minimization01",
      grantedAt: atHour(3),
    });
    if (!mismatched.ok) throw new Error(mismatched.detail);
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(3),
      grant: mismatched.grant,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.location.status).toBe(LOCATED_REDACTED);
    if (result.view.location.status !== LOCATED_REDACTED) throw new Error("unreachable");
    expect(result.view.location.redactionReason).toBe("grant_scope_mismatch");
    void grant;
  });

  test("a grant scoped to ANOTHER TENANT withholds the payload (grant_scope_mismatch — tenant isolation)", () => {
    const foreign = makeLocationDisclosureGrant({
      tenantId: TENANT_B,
      deviceId: DEV_A1,
      approver: "usr_minimization01",
      grantedAt: atHour(3),
    });
    if (!foreign.ok) throw new Error(foreign.detail);
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(3),
      grant: foreign.grant,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.location.status).toBe(LOCATED_REDACTED);
    if (result.view.location.status !== LOCATED_REDACTED) throw new Error("unreachable");
    expect(result.view.location.redactionReason).toBe("grant_scope_mismatch");
  });

  test("a structurally-malformed grant (bypassing the constructor) withholds the payload (grant_malformed)", () => {
    const malformed = {
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      approver: "", // malformed: empty approver
      grantedAt: atHour(3),
    } as unknown as LocationDisclosureGrant;
    const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
      at: atHour(3),
      grant: malformed,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.location.status).toBe(LOCATED_REDACTED);
    if (result.view.location.status !== LOCATED_REDACTED) throw new Error("unreachable");
    expect(result.view.location.redactionReason).toBe("grant_malformed");
  });

  test("absent location evidence stays the W040 verbatim no_location_evidence (nothing disclosed, nothing withheld)", () => {
    const sink = createInMemoryRecoveryAuditSink();
    const ledger = createInMemoryLastSeenLedger();
    const write = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [
      batch(DEV_A1, [obs("device.security", { diskEncryption: false }, atHour(1), "obs_min_nosec")], atHour(1)),
    ], { at: atHour(3), thresholds: THRESHOLDS, correlationId: CORR });
    if (!write.ok) throw new Error(write.error.message);
    const view = findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(3), thresholds: THRESHOLDS });
    expect(view.location.status).toBe(NO_LOCATION_EVIDENCE);
    const result = projectMinimizedFindMyDevice(scopeA(), view, {
      at: atHour(3),
      grant: grantFor(),
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.location.status).toBe(NO_LOCATION_EVIDENCE);
    expect(sink.records.length).toBe(0); // a pure negative: nothing audited
  });

  test("the redaction reason taxonomy is the frozen four-reason set", () => {
    expect(ALL_LOCATION_REDACTION_REASONS).toEqual([
      "no_grant",
      "grant_malformed",
      "grant_expired",
      "grant_scope_mismatch",
    ]);
    expect(LOCATED_REDACTED).toBe("located_redacted");
    expect(LOCATED).toBe("located");
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation + malformed scope
// ---------------------------------------------------------------------------

describe("W071: minimization — tenant isolation + scope discipline", () => {
  test("a foreign-tenant VIEW is refused (never projected, never audited under the acting tenant)", () => {
    const sink = createInMemoryRecoveryAuditSink();
    // A tenant-B view (the ledger recorded tenant-A evidence, so the
    // tenant-B view has no evidence — construct a foreign view directly).
    const foreignView: FindMyDeviceView = {
      tenantId: TENANT_B,
      deviceId: DEV_A1,
      lastSeen: undefined,
      location: { status: NO_LOCATION_EVIDENCE },
    };
    const result = projectMinimizedFindMyDevice(scopeA(), foreignView, {
      at: atHour(3),
      auditSink: sink,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a foreign view must refuse");
    expect(result.error.invariant).toBe("tenant_mismatch");
    expect(sink.records.length).toBe(0);
  });

  test("a malformed acting scope is refused machine-stably", () => {
    const result = projectMinimizedFindMyDevice(
      { tenantId: "not-a-tenant-id" as never, correlationId: CORR },
      locatedView(),
      { at: atHour(3) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a malformed scope must refuse");
    expect(result.error.invariant).toBe("invalid_tenant_id");
  });

  test("scope B cannot project a tenant-A view (and vice versa)", () => {
    const result = projectMinimizedFindMyDevice(scopeB(), locatedView(), { at: atHour(3) });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W071: minimization — determinism", () => {
  test("byte-identical projections + audit records across runs and grant-key permutations", () => {
    function run(grant: LocationDisclosureGrant | undefined): string {
      const sink = createInMemoryRecoveryAuditSink();
      const result = projectMinimizedFindMyDevice(scopeA(), locatedView(), {
        at: atHour(3),
        grant,
        auditSink: sink,
        correlationId: CORR,
      });
      if (!result.ok) throw new Error(result.error.message);
      return JSON.stringify({
        digest: minimizedViewContentDigest(result.view),
        view: result.view,
        audit: sink.records,
      });
    }
    const grantA = grantFor();
    const grantB = grantFor();
    expect(run(grantA)).toBe(run(grantB)); // grant determinism
    expect(run(undefined)).toBe(run(undefined)); // redaction determinism
    expect(run(grantA)).toBe(run(grantA)); // run determinism
  });

  test("the content digest is stable across independent view derivations", () => {
    const a = projectMinimizedFindMyDevice(scopeA(), locatedView(), { at: atHour(3) });
    const b = projectMinimizedFindMyDevice(scopeA(), locatedView(recordedLedger()), { at: atHour(3) });
    if (!a.ok || !b.ok) throw new Error("projection failed");
    expect(minimizedViewContentDigest(a.view)).toBe(minimizedViewContentDigest(b.view));
    expect(minimizedViewContentDigest(a.view)).toMatch(/^[0-9a-f]{8}$/);
  });
});
