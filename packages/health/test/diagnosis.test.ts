/**
 * W021 D4 tests — diagnosis hypotheses, treatment recommendations,
 * the append-only ledger, and the audit seam.
 *
 * Core invariants under test:
 *   - hypotheses/recommendations are PROPOSALS (no intent id, no lifecycle);
 *   - confidence is a deterministic function of matched anomaly severities;
 *   - the ledger is append-only: supersession via NEW records, never edits;
 *   - dismissal closes a lineage (and its recommendations) until re-proposed;
 *   - audit records are emitted for every consequential interpretation.
 */

import { describe, expect, test } from "bun:test";
import { MAINTAIN_DEVICE_INTENT_KIND, RECOVERY_INTENT_KIND, REPLACEMENT_INTENT_KIND } from "@fleetos/contracts";
import {
  CAUSE_LIBRARY,
  CAUSE_LIBRARY_VERSION,
  DIAGNOSIS_ENGINE_VERSION,
  MAX_HYPOTHESIS_CONFIDENCE,
  SEVERITY_CONFIDENCE_FACTORS,
  appendHypothesis,
  appendRecommendation,
  createDiagnosisLedger,
  diagnose,
  dismissHypothesis,
  hypothesisStatus,
  resolveActiveInterpretations,
} from "../src/diagnosis";
import { createInMemoryHealthAuditSink } from "../src/audit-seam";
import { HEALTH_AUDIT_ACTIONS } from "../src/audit-seam";
import { detectAnomalies } from "../src/anomalies";
import type { HealthAnomaly } from "../src/anomalies";
import { buildDeviceBaseline } from "../src/baselines";
import { CORR, DEVICE_1, DEVICE_2, TENANT_A, TENANT_B, atHour, signal } from "./helpers";

const WINDOW = { asOf: atHour(24), windowMs: 24 * 3_600_000 };

/** Deterministically derive real anomalies for the given signals. */
function anomaliesFor(signals: ReturnType<typeof signal>[]): HealthAnomaly[] {
  const result = detectAnomalies(signals, { tenantId: TENANT_A, ...WINDOW });
  if (!result.ok) throw new Error("detection failed");
  return [...result.anomalies];
}

function lowBatteryAnomaly(severityValue: number): HealthAnomaly[] {
  return anomaliesFor([signal("battery.capacity", severityValue, atHour(10))]);
}

describe("D4: cause library integrity", () => {
  test("seven causes, unique ids, deterministic order, every treatment names an intent kind", () => {
    expect(CAUSE_LIBRARY.length).toBe(7);
    const ids = CAUSE_LIBRARY.map((c) => c.causeId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cause of CAUSE_LIBRARY) {
      expect(cause.evidenceRules.length > 0).toBe(true);
      expect(cause.treatment.actionId.length > 0).toBe(true);
      expect([
        MAINTAIN_DEVICE_INTENT_KIND,
        REPLACEMENT_INTENT_KIND,
        RECOVERY_INTENT_KIND,
      ]).toContain(cause.treatment.intentKind);
      for (const rule of cause.evidenceRules) {
        expect(rule.weight > 0).toBe(true);
        expect(rule.weight <= 1).toBe(true);
      }
    }
    expect(CAUSE_LIBRARY_VERSION).toBe(1);
    expect(DIAGNOSIS_ENGINE_VERSION).toBe("health-diagnosis/1");
  });
});

describe("D4: diagnose — hypotheses", () => {
  test("a battery anomaly produces the battery_aging hypothesis with deterministic confidence", () => {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses).toHaveLength(1);
    const h = result.hypotheses[0];
    expect(h.causeId).toBe("health.battery_aging");
    expect(h.label).toBe("Battery degraded");
    expect(h.confidence).toBe(0.85 * SEVERITY_CONFIDENCE_FACTORS.CRITICAL);
    expect(h.interpretationVersion).toBe(1);
    expect(h.supersedes).toBeUndefined();
    expect(h.tenantId).toBe(TENANT_A);
    expect(h.deviceId).toBe(DEVICE_1);
    expect(h.proposedAt).toBe(atHour(24));
    expect(h.engineVersion).toBe(DIAGNOSIS_ENGINE_VERSION);
    expect(h.evidence[0].ruleId).toBe("battery.low");
    expect(h.evidence[0].severity).toBe("CRITICAL");
    expect(h.evidence[0].anomalyId.length > 0).toBe(true);
  });

  test("WARNING-severity evidence contributes less confidence than CRITICAL", () => {
    const warning = diagnose(lowBatteryAnomaly(15), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(warning.ok && warning.hypotheses[0].confidence).toBe(
      0.85 * SEVERITY_CONFIDENCE_FACTORS.WARNING,
    );
  });

  test("no anomalies -> no hypotheses", () => {
    const result = diagnose([], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok && result.hypotheses).toHaveLength(0);
    expect(result.ok && result.recommendations).toHaveLength(0);
  });

  test("multi-evidence causes cap confidence at the documented maximum", () => {
    // crash.burst (5 events, CRITICAL) + boot.slow (deviation vs constant
    // baseline, CRITICAL) drive both multi-evidence causes over the cap:
    //   recurring_crashes: 0.9 + 0.5 = 1.4 -> capped at 0.99
    //   hardware_failing:  0.6 + 0.6 = 1.2 -> capped at 0.99
    const bootHistory = Array.from({ length: 8 }, (_, i) => signal("boot.time", 20_000, atHour(i + 1)));
    const bootBaseline = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "boot.time",
      window: WINDOW,
      signals: bootHistory,
    });
    if (!bootBaseline.ok) throw new Error("baseline failed");
    const anomalies = detectAnomalies(
      [
        ...bootHistory.slice(0, 5).map((s) => signal("crash.event", 1, s.observedAt)),
        signal("boot.time", 90_000, atHour(23)),
      ],
      { tenantId: TENANT_A, ...WINDOW, baselines: [bootBaseline.baseline] },
    );
    if (!anomalies.ok) throw new Error("detection failed");
    expect(anomalies.anomalies.map((a) => a.ruleId).sort()).toEqual(["boot.slow", "crash.burst"]);

    const result = diagnose(anomalies.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recurring = result.hypotheses.find((h) => h.causeId === "health.recurring_crashes")!;
    const failing = result.hypotheses.find((h) => h.causeId === "health.hardware_failing")!;
    expect(recurring.confidence).toBe(MAX_HYPOTHESIS_CONFIDENCE);
    expect(failing.confidence).toBe(MAX_HYPOTHESIS_CONFIDENCE);
    // Both hypotheses carry BOTH evidence rules.
    expect(recurring.evidence.map((e) => e.ruleId).sort()).toEqual(["boot.slow", "crash.burst"]);
    expect(failing.evidence.map((e) => e.ruleId).sort()).toEqual(["boot.slow", "crash.burst"]);
  });

  test("hypotheses follow cause-library order", () => {
    const anomalies = anomaliesFor([
      signal("battery.capacity", 5, atHour(10)),
      signal("storage.usage", 0.97, atHour(11)),
      signal("temperature.core", 90, atHour(12)),
    ]);
    const result = diagnose(anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok && result.hypotheses.map((h) => h.causeId)).toEqual([
      "health.battery_aging",
      "health.disk_near_full",
      "health.thermal_stress",
    ]);
  });

  test("validation: missing correlation id or bad timestamp rejects the run", () => {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: "not-iso",
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("health.diagnosis.invalid_request");
  });

  test("a foreign-tenant anomaly is rejected (tenant isolation by rejection)", () => {
    // Derive the anomaly under tenant B's scope (detection validates scope),
    // then attempt to diagnose it under tenant A.
    const detected = detectAnomalies(
      [signal("battery.capacity", 5, atHour(10), { tenantId: TENANT_B })],
      { tenantId: TENANT_B, ...WINDOW },
    );
    if (!detected.ok) throw new Error("detection failed");
    const result = diagnose(detected.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });

  test("a foreign-device anomaly is rejected", () => {
    const foreign = anomaliesFor([
      signal("battery.capacity", 5, atHour(10), { deviceId: DEVICE_2 }),
    ]);
    const result = diagnose(foreign, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("device_mismatch");
  });
});

describe("D4: diagnose — treatment recommendations (PROPOSALS ONLY)", () => {
  test("the battery hypothesis proposes a MaintainDeviceIntent draft payload", () => {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations).toHaveLength(1);
    const r = result.recommendations[0];
    expect(r.hypothesisId).toBe(result.hypotheses[0].id);
    expect(r.actionId).toBe("maintain.battery_service");
    expect(r.proposedIntent.intentKind).toBe(MAINTAIN_DEVICE_INTENT_KIND);
    expect(r.proposedIntent.payload).toEqual({
      deviceId: DEVICE_1,
      description: CAUSE_LIBRARY[0].treatment.description,
    });
    expect(r.rationale).toContain("battery.low");
    expect(r.rationale).toContain("Proposal only");
    expect(r.confidence).toBe(result.hypotheses[0].confidence);
    expect(r.recommendationVersion).toBe(1);
  });

  test("the crash hypothesis proposes a RecoveryIntent reboot draft", () => {
    const anomalies = anomaliesFor([
      ...Array.from({ length: 5 }, (_, i) => signal("crash.event", 1, atHour(i + 1))),
    ]);
    const result = diagnose(anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations.find(
      (r) => r.actionId === "recover.reboot",
    )!;
    expect(rec.proposedIntent.intentKind).toBe(RECOVERY_INTENT_KIND);
    expect(rec.proposedIntent.payload).toEqual({
      deviceId: DEVICE_1,
      action: "reboot",
    });
  });

  test("recommendations carry NO intent id and NO lifecycle state — proposals only", () => {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const r of result.recommendations) {
      expect("intentId" in r).toBe(false);
      expect("status" in r).toBe(false);
      expect("intentId" in r.proposedIntent).toBe(false);
      expect("status" in r.proposedIntent).toBe(false);
      const payload = r.proposedIntent.payload as unknown as Record<string, unknown>;
      expect("intentId" in payload).toBe(false);
      expect("status" in payload).toBe(false);
      expect("requestedAt" in payload).toBe(false);
    }
  });

  test("the replacement cause proposes a ReplacementIntent with a reason", () => {
    // hardware_failing needs crash.burst + boot.slow; crash alone fires it at 0.6.
    const anomalies = anomaliesFor([
      ...Array.from({ length: 5 }, (_, i) => signal("crash.event", 1, atHour(i + 1))),
    ]);
    const result = diagnose(anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations.find((r) => r.actionId === "replace.hardware")!;
    expect(rec.proposedIntent.intentKind).toBe(REPLACEMENT_INTENT_KIND);
    const payload = rec.proposedIntent.payload as { deviceId?: string; reason?: string };
    expect(payload.deviceId).toBe(DEVICE_1);
    expect(payload.reason).toContain("crash");
  });
});

describe("D4: audit emission (W011's injected-sink pattern)", () => {
  test("one audit record per hypothesis and per recommendation, with traceability", () => {
    const sink = createInMemoryHealthAuditSink();
    const anomalies = anomaliesFor([
      signal("battery.capacity", 5, atHour(10)),
      signal("storage.usage", 0.97, atHour(11)),
    ]);
    const result = diagnose(anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sink.records).toHaveLength(4); // 2 hypotheses + 2 recommendations
    const actions = sink.records.map((r) => r.action).sort();
    expect(actions).toEqual([
      HEALTH_AUDIT_ACTIONS.diagnosisProposed,
      HEALTH_AUDIT_ACTIONS.diagnosisProposed,
      HEALTH_AUDIT_ACTIONS.treatmentProposed,
      HEALTH_AUDIT_ACTIONS.treatmentProposed,
    ]);
    for (const record of sink.records) {
      expect(record.tenantId).toBe(TENANT_A);
      expect(record.subject).toBe(DEVICE_1);
      expect(record.occurredAt).toBe(atHour(24));
      expect(record.correlationId).toBe(CORR);
      expect(record.details.engineVersion).toBe(DIAGNOSIS_ENGINE_VERSION);
    }
    const treatment = sink.records.find((r) => r.action === HEALTH_AUDIT_ACTIONS.treatmentProposed)!;
    expect(treatment.details.proposedIntentKind).toBe(MAINTAIN_DEVICE_INTENT_KIND);
  });

  test("the default (no sink injected) is the documented no-op", () => {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    expect(result.ok).toBe(true); // no crash, nothing emitted
  });

  test("dismissal emits its own audit action", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const sink = createInMemoryHealthAuditSink();
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    if (!result.ok) throw new Error("diagnose failed");
    const appendedHypothesis = appendHypothesis(ledger, result.hypotheses[0]);
    if (!appendedHypothesis.ok) throw new Error("append hypothesis failed");
    const appendedRecommendation = appendRecommendation(appendedHypothesis.ledger, result.recommendations[0]);
    if (!appendedRecommendation.ok) throw new Error("append recommendation failed");
    const appended = appendedRecommendation.ledger;

    const dismissed = dismissHypothesis(appended, result.hypotheses[0].id, {
      at: atHour(25),
      reason: "operator_rejected",
      correlationId: CORR,
      auditSink: sink,
    });
    expect(dismissed.ok).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].action).toBe(HEALTH_AUDIT_ACTIONS.hypothesisDismissed);
    expect(sink.records[0].details.reason).toBe("operator_rejected");
    expect(sink.records[0].occurredAt).toBe(atHour(25));
  });
});

describe("D4: the append-only ledger + versioned interpretation", () => {
  function firstRun() {
    const result = diagnose(lowBatteryAnomaly(8), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    if (!result.ok) throw new Error("diagnose failed");
    return result;
  }

  test("re-diagnosis produces version 2 records that supersede version 1 (never edit)", () => {
    const run1 = firstRun();
    const history = [
      { kind: "hypothesis" as const, hypothesis: run1.hypotheses[0] },
      { kind: "recommendation" as const, recommendation: run1.recommendations[0] },
    ];
    const run2 = diagnose(lowBatteryAnomaly(6), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: CORR,
      history,
    });
    expect(run2.ok).toBe(true);
    if (!run2.ok) return;
    const h2 = run2.hypotheses[0];
    expect(h2.interpretationVersion).toBe(2);
    expect(h2.supersedes).toBe(run1.hypotheses[0].id);
    expect(h2.id).not.toBe(run1.hypotheses[0].id);
    expect(h2.proposedAt).toBe(atHour(48));
    const r2 = run2.recommendations[0];
    expect(r2.recommendationVersion).toBe(2);
    expect(r2.supersedes).toBe(run1.recommendations[0].id);
    // The version-1 records are untouched (frozen, byte-identical):
    expect(run1.hypotheses[0].interpretationVersion).toBe(1);
    expect("supersedes" in run1.hypotheses[0]).toBe(false);
  });

  test("appendHypothesis/appendRecommendation return NEW ledgers; inputs untouched", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run = firstRun();
    const next = appendHypothesis(ledger, run.hypotheses[0]);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ledger.entries).toHaveLength(1);
    expect(ledger.entries).toHaveLength(0); // the original is untouched
    const next2 = appendRecommendation(next.ledger, run.recommendations[0]);
    expect(next2.ok && next2.ledger.entries).toHaveLength(2);
  });

  test("appending a foreign-scope record is rejected", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run = firstRun();
    const foreign = { ...run.hypotheses[0], tenantId: TENANT_B };
    const result = appendHypothesis(ledger, foreign);
    expect(result.ok).toBe(false);
  });

  test("duplicate ids are rejected (idempotent ledger appends)", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run = firstRun();
    const once = appendHypothesis(ledger, run.hypotheses[0]);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = appendHypothesis(once.ledger, run.hypotheses[0]);
    expect(twice.ok).toBe(false);
  });

  test("resolveActiveInterpretations: supersession + dismissal drive the active view", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run1 = firstRun();
    const appendedHypothesis = appendHypothesis(ledger, run1.hypotheses[0]);
    expect(appendedHypothesis.ok).toBe(true);
    if (!appendedHypothesis.ok) return;
    const appendedRecommendation = appendRecommendation(appendedHypothesis.ledger, run1.recommendations[0]);
    expect(appendedRecommendation.ok).toBe(true);
    if (!appendedRecommendation.ok) return;
    const ledger1 = appendedRecommendation.ledger;

    // Active after run 1.
    const active1 = resolveActiveInterpretations(ledger1);
    expect(active1.hypotheses.map((h) => h.id)).toEqual([run1.hypotheses[0].id]);
    expect(active1.recommendations.map((r) => r.id)).toEqual([run1.recommendations[0].id]);
    expect(hypothesisStatus(ledger1, run1.hypotheses[0].id)).toBe("ACTIVE");

    // Run 2 supersedes.
    const run2 = diagnose(lowBatteryAnomaly(6), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: CORR,
      history: ledger1.entries,
    });
    if (!run2.ok) throw new Error("run2 failed");
    const ledger2a = appendHypothesis(ledger1, run2.hypotheses[0]);
    expect(ledger2a.ok).toBe(true);
    if (!ledger2a.ok) return;
    const ledger2 = appendRecommendation(ledger2a.ledger, run2.recommendations[0]);
    expect(ledger2.ok).toBe(true);
    if (!ledger2.ok) return;

    const active2 = resolveActiveInterpretations(ledger2.ledger);
    expect(active2.hypotheses.map((h) => h.id)).toEqual([run2.hypotheses[0].id]);
    expect(active2.recommendations.map((r) => r.id)).toEqual([run2.recommendations[0].id]);
    expect(hypothesisStatus(ledger2.ledger, run1.hypotheses[0].id)).toBe("SUPERSEDED");

    // Dismiss the active interpretation: recommendations go inactive too.
    const dismissed = dismissHypothesis(ledger2.ledger, run2.hypotheses[0].id, {
      at: atHour(50),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    expect(dismissed.ok).toBe(true);
    if (!dismissed.ok) return;
    const active3 = resolveActiveInterpretations(dismissed.ledger);
    expect(active3.hypotheses).toHaveLength(0);
    expect(active3.recommendations).toHaveLength(0);
    expect(hypothesisStatus(dismissed.ledger, run2.hypotheses[0].id)).toBe("DISMISSED");
    expect(hypothesisStatus(dismissed.ledger, run1.hypotheses[0].id)).toBe("SUPERSEDED");
  });

  test("dismissal guards: unknown, double-dismiss, and already-superseded", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run = firstRun();
    const withHypothesis = appendHypothesis(ledger, run.hypotheses[0]);
    if (!withHypothesis.ok) throw new Error("append failed");

    const unknown = dismissHypothesis(withHypothesis.ledger, "hyp_does_not_exist", {
      at: atHour(25),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    expect(unknown.ok).toBe(false);

    const first = dismissHypothesis(withHypothesis.ledger, run.hypotheses[0].id, {
      at: atHour(25),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = dismissHypothesis(first.ledger, run.hypotheses[0].id, {
      at: atHour(26),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    expect(second.ok).toBe(false);

    // A later hypothesis supersedes; dismissing the OLD one is rejected.
    const run2 = diagnose(lowBatteryAnomaly(6), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: CORR,
      history: first.ledger.entries,
    });
    if (!run2.ok) throw new Error("run2 failed");
    const reopened = appendHypothesis(first.ledger, run2.hypotheses[0]);
    if (!reopened.ok) throw new Error("append failed");
    const dismissOld = dismissHypothesis(reopened.ledger, run.hypotheses[0].id, {
      at: atHour(49),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    expect(dismissOld.ok).toBe(false);
  });

  test("a dismissed cause may be re-proposed by fresh evidence (append-only history)", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const run1 = firstRun();
    const withHypothesis = appendHypothesis(ledger, run1.hypotheses[0]);
    if (!withHypothesis.ok) throw new Error("append failed");
    const dismissed = dismissHypothesis(withHypothesis.ledger, run1.hypotheses[0].id, {
      at: atHour(25),
      reason: "operator_rejected",
      correlationId: CORR,
    });
    if (!dismissed.ok) throw new Error("dismiss failed");

    const run2 = diagnose(lowBatteryAnomaly(4), {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: CORR,
      history: dismissed.ledger.entries,
    });
    if (!run2.ok) throw new Error("run2 failed");
    expect(run2.hypotheses[0].interpretationVersion).toBe(2);
    expect(run2.hypotheses[0].supersedes).toBe(run1.hypotheses[0].id);
    const reopened = appendHypothesis(dismissed.ledger, run2.hypotheses[0]);
    if (!reopened.ok) throw new Error("append failed");
    const active = resolveActiveInterpretations(reopened.ledger);
    expect(active.hypotheses.map((h) => h.id)).toEqual([run2.hypotheses[0].id]);
    // The dismissal remains in the journal as historical fact.
    expect(
      reopened.ledger.entries.some(
        (e) => e.kind === "dismissal" && e.dismissal.hypothesisId === run1.hypotheses[0].id,
      ),
    ).toBe(true);
  });
});

describe("D4: determinism", () => {
  test("the same anomalies + history produce identical hypotheses and recommendations", () => {
    const anomalies = anomaliesFor([
      signal("battery.capacity", 5, atHour(10)),
      signal("storage.usage", 0.97, atHour(11)),
      ...Array.from({ length: 3 }, (_, i) => signal("crash.event", 1, atHour(i + 1))),
    ]);
    const options = {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    };
    const run1 = diagnose(anomalies, options);
    const run2 = diagnose(anomalies, options);
    expect(run1).toEqual(run2);
  });

  test("cross-tenant history is rejected before any interpretation is produced", () => {
    const anomalies = anomaliesFor([signal("battery.capacity", 5, atHour(10))]);
    const run = diagnose(anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
    });
    if (!run.ok) throw new Error("diagnose failed");
    const history = [{ kind: "hypothesis" as const, hypothesis: run.hypotheses[0] }];
    const result = diagnose(anomalies, {
      tenantId: TENANT_B,
      deviceId: DEVICE_1,
      at: atHour(24),
      correlationId: CORR,
      history,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });
});
