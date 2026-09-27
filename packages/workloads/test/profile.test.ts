/**
 * W022 D1 tests — the WorkloadProfile model: identity, revisions,
 * immutability, content hashes, validation.
 *
 * Core invariants under test:
 *   - revision 1 is built deterministically (derived id + content hash);
 *   - revision N+1 is a NEW frozen record; the prior revision is
 *     byte-identical after the update (revision immutability);
 *   - subjectKind and workloadId are stable across revisions;
 *   - validation failures are tagged ValidationError-shaped FleetErrors
 *     with machine paths.
 */

import { describe, expect, test } from "bun:test";
import { toApiError } from "@fleetos/contracts";
import { WORKLOAD_PROFILE_SCHEMA_VERSION, buildWorkloadProfile, reviseWorkloadProfile } from "../src/profile";
import { CORR, TENANT_A, T0, T1, WL_1, balancedVector, createInput, fieldVector, profile } from "./helpers";

describe("D1: buildWorkloadProfile (revision 1)", () => {
  test("builds a frozen, tenant-scoped revision-1 profile with a deterministic content hash", () => {
    const built = buildWorkloadProfile(TENANT_A, createInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { profile: p } = built;
    expect(p.tenantId).toBe(TENANT_A);
    expect(p.workloadId).toBe(WL_1);
    expect(p.subjectKind).toBe("role");
    expect(p.name).toBe("finance.analyst");
    expect(p.revision).toBe(1);
    expect(p.schemaVersion).toBe(WORKLOAD_PROFILE_SCHEMA_VERSION);
    expect(p.createdAt).toBe(T0);
    expect(p.evidence).toEqual([]);
    expect(p.constraints).toEqual({});
    expect(typeof p.contentHash).toBe("string");
    expect(p.contentHash).toHaveLength(8);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.requirements)).toBe(true);
    expect(Object.isFrozen(p.requirements.values)).toBe(true);
  });

  test("the workload id is derived deterministically when absent", () => {
    const input = createInput({ workloadId: undefined });
    const first = buildWorkloadProfile(TENANT_A, input);
    const second = buildWorkloadProfile(TENANT_A, input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.profile.workloadId).toBe(second.profile.workloadId);
    expect(first.profile.workloadId.startsWith("wl_")).toBe(true);
    // The identity tuple includes the tenant: different tenants derive
    // different ids for the same role name.
    const other = buildWorkloadProfile(
      "tnt_othertenant00" as typeof TENANT_A,
      input,
    );
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(other.profile.workloadId).not.toBe(first.profile.workloadId);
    }
  });

  test("byte-identical determinism: same input -> same profile (hash-stable)", () => {
    const a = buildWorkloadProfile(TENANT_A, createInput());
    const b = buildWorkloadProfile(TENANT_A, createInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the content hash binds the content: any change changes the hash", () => {
    const base = profile();
    const renamed = profile({ name: "finance.analyst.senior" });
    const revectored = profile({ requirements: fieldVector() });
    const retime = profile({ at: T1 });
    expect(renamed.contentHash).not.toBe(base.contentHash);
    expect(revectored.contentHash).not.toBe(base.contentHash);
    expect(retime.contentHash).not.toBe(base.contentHash);
  });

  test("evidence and constraints are accepted and frozen", () => {
    const p = profile({
      constraints: {
        requiredApplications: [{ appId: "app.office_suite", minVersion: "2026.0" }],
        environments: ["office", "home"],
        peripherals: ["dock"],
        classification: "internal",
      },
      workingHours: { startHour: 9, endHour: 17 },
      evidence: [{ observationId: "obs_1", kind: "device.workload", note: "cpu sustained 0.4" }],
    });
    expect(p.constraints.requiredApplications?.[0]?.appId).toBe("app.office_suite");
    expect(p.workingHours).toEqual({ startHour: 9, endHour: 17 });
    expect(p.evidence.length).toBe(1);
    expect(Object.isFrozen(p.evidence)).toBe(true);
  });
});

describe("D1: validation failures (tagged, machine-stable)", () => {
  test("bad subject kind, name, description, at, correlation, requirements fail with paths", () => {
    const badKind = buildWorkloadProfile(TENANT_A, createInput({ subjectKind: "robot" as never }));
    expect(badKind.ok).toBe(false);
    if (badKind.ok || badKind.error.kind !== "ValidationError") return;
    expect(badKind.error.kind).toBe("ValidationError");
    expect(badKind.error.code).toBe("workloads.profile.invalid_request");
    expect(badKind.error.failures).toEqual([{ path: "/subjectKind", reason: "must_be_role_or_process" }]);

    const badName = buildWorkloadProfile(TENANT_A, createInput({ name: "" }));
    expect(badName.ok).toBe(false);
    if (badName.ok || badName.error.kind !== "ValidationError") return;
    expect(
      badName.error.failures.some((f) => f.path === "/name" && f.reason === "required_1_200_chars"),
    ).toBe(true);

    const badAt = buildWorkloadProfile(TENANT_A, createInput({ at: "yesterday" }));
    expect(badAt.ok).toBe(false);

    const badVector = buildWorkloadProfile(TENANT_A, {
      ...createInput(),
      requirements: { ...balancedVector(), values: { ...balancedVector().values, cpuDemand: 2 } },
    });
    expect(badVector.ok).toBe(false);
    if (badVector.ok || badVector.error.kind !== "ValidationError") return;
    expect(
      badVector.error.failures.some((f) => f.path === "/requirements/cpuDemand" && f.reason === "out_of_range"),
    ).toBe(true);

    const badHours = buildWorkloadProfile(TENANT_A, createInput({ workingHours: { startHour: 24, endHour: 0 } }));
    expect(badHours.ok).toBe(false);
    if (badHours.ok || badHours.error.kind !== "ValidationError") return;
    expect(badHours.error.failures).toEqual([
      { path: "/workingHours/startHour", reason: "not_hour_0_23" },
      { path: "/workingHours/endHour", reason: "not_hour_1_24" },
    ]);

    const badEvidence = buildWorkloadProfile(TENANT_A, createInput({ evidence: [{ observationId: "" }] }));
    expect(badEvidence.ok).toBe(false);
  });

  test("errors carry the frozen taxonomy shape and translate through toApiError", () => {
    const bad = buildWorkloadProfile(TENANT_A, createInput({ name: "" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.tenantId).toBe(TENANT_A);
    expect(bad.error.correlationId).toBe(CORR);
    // The frozen taxonomy maps ValidationError to 400.
    const api = toApiError(bad.error);
    expect(api.status).toBe(400);
  });

  test("a missing tenant fails; the error projects the synthetic system tenant (W012 convention)", () => {
    const bad = buildWorkloadProfile("" as typeof TENANT_A, createInput());
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.correlationId).toBe(CORR);
    expect(bad.error.tenantId).toBe("tnt_system");
  });
});

describe("D1: reviseWorkloadProfile (revision N+1)", () => {
  test("a revision is a NEW frozen record with prior.revision + 1 and a fresh hash", () => {
    const prior = profile();
    const revised = reviseWorkloadProfile(prior, {
      name: prior.name,
      description: "Updated: added BI modeling.",
      requirements: fieldVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const { profile: next } = revised;
    expect(next.revision).toBe(2);
    expect(next.workloadId).toBe(prior.workloadId);
    expect(next.tenantId).toBe(prior.tenantId);
    expect(next.subjectKind).toBe(prior.subjectKind);
    expect(next.description).toBe("Updated: added BI modeling.");
    expect(next.requirements.values.mobilityDemand).toBe(0.9);
    expect(next.createdAt).toBe(T1);
    expect(next.contentHash).not.toBe(prior.contentHash);
    // The prior revision is untouched (immutability).
    expect(prior.revision).toBe(1);
    expect(prior.description).toBe("Financial analyst workload: spreadsheets, BI dashboards, video calls.");
    expect(Object.isFrozen(next)).toBe(true);
  });

  test("revisions are append-only by construction: the prior record never changes", () => {
    const rev1 = profile();
    const snapshot = JSON.stringify(rev1);
    let current = rev1;
    for (let i = 2; i <= 5; i++) {
      const revised = reviseWorkloadProfile(current, {
        name: current.name,
        description: `Revision ${i}`,
        requirements: current.requirements,
        at: T1,
        correlationId: CORR,
      });
      expect(revised.ok).toBe(true);
      if (!revised.ok) return;
      expect(revised.profile.revision).toBe(i);
      current = revised.profile;
    }
    expect(JSON.stringify(rev1)).toBe(snapshot);
    expect(current.revision).toBe(5);
  });

  test("revisions inherit subjectKind (immutable identity); bad revisions fail tagged", () => {
    const prior = profile({ subjectKind: "process" });
    const revised = reviseWorkloadProfile(prior, {
      name: prior.name,
      description: prior.description,
      requirements: prior.requirements,
      at: T1,
      correlationId: CORR,
    });
    expect(revised.ok).toBe(true);
    if (revised.ok) {
      expect(revised.profile.subjectKind).toBe("process");
    }

    const bad = reviseWorkloadProfile(prior, {
      name: "",
      description: prior.description,
      requirements: prior.requirements,
      at: T1,
      correlationId: CORR,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe("workloads.profile.invalid_request");
    expect(bad.error.tenantId).toBe(TENANT_A);
  });
});
