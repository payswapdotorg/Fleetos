/**
 * W050C aurum adapter — the authority-boundary tests (D3).
 *
 * The AURUM.md invariant: "Aurum returns delivery/outcome metadata and
 * cannot mutate FleetOS truth except through explicitly authorized
 * FleetOS action APIs." This suite asserts the package's PUBLIC SURFACE
 * contains only emission + metadata ingestion + pure/read-only helpers
 * — no store-mutation path for ANY FleetOS domain — and that src/
 * never imports a domain package (the structural-seam discipline).
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as aurum from "../src/index";

/**
 * The exhaustive value-export allowlist. Every name is classified:
 *   - PURE builder/helper/derivation
 *   - EMISSION (the adapter's own outbox + injected transport + audit)
 *   - INGESTION (the metadata-only return path)
 *   - READ-ONLY query/summary
 *   - SEAM/constant/in-memory reference
 * Anything NOT on this list fails the boundary by definition. Adding a
 * name here is a deliberate, reviewable authority-boundary change.
 */
const EXPECTED_EXPORTS = new Set([
  // content.ts — the derived content + redaction model (PURE)
  "REDACTED_VALUE",
  "NO_REDACTION",
  "applyRedaction",
  "contentFieldKeys",
  "validateRedactionPolicy",
  // intents.ts — the six pure builders + seams + derivation tables (PURE)
  "COMMUNICATION_KINDS",
  "ALL_COMMUNICATION_KINDS",
  "ALL_MESSAGE_PRIORITIES",
  "COMMUNICATION_INTENT_SCHEMA_VERSION",
  "MAINTENANCE_NOTICE_EVENTS",
  "INCIDENT_SEVERITIES",
  "INCIDENT_PRIORITY_BY_SEVERITY",
  "APPROVAL_SURFACES",
  "RECOVERY_CASE_STATUSES",
  "RECOVERY_PRIORITY_BY_STATUS",
  "QUOTE_EVENTS",
  "QUOTE_STATUS_BY_EVENT",
  "BRIEFING_DEADLINE_SOURCES",
  "buildMaintenanceNotice",
  "buildIncidentWarning",
  "buildApprovalRequest",
  "buildRecoveryMessage",
  "buildProcurementUpdate",
  "buildManagerBriefing",
  // outbox.ts — the adapter's OWN ledger (EMISSION + READ-ONLY)
  "OUTBOX_ENTRY_SCHEMA_VERSION",
  "createInMemoryOutboxLedger",
  "asTenantScopedOutboxStore",
  "summarizeOutbox",
  "SYNTHETIC_SYSTEM_TENANT_ID",
  // transport.ts — the injected transport seam (EMISSION)
  "toTransportEmission",
  "createInMemoryTransport",
  // emission.ts — the emission boundary (EMISSION)
  "emitCommunicationMessage",
  "UNBOUND_TRANSPORT_REFUSAL_REASON",
  // delivery.ts — the metadata-only return path (INGESTION + READ-ONLY)
  "DELIVERY_STATES",
  "DELIVERY_STATE_TRANSITIONS",
  "TERMINAL_DELIVERY_STATES",
  "DELIVERY_DISPOSITIONS",
  "DELIVERY_DISPOSITION_BY_STATE",
  "canTransitionDeliveryState",
  "dispositionForState",
  "DELIVERY_RECORD_SCHEMA_VERSION",
  "createInMemoryDeliveryLedger",
  "asTenantScopedDeliveryStore",
  "deliveryContentDigest",
  "ingestDeliveryMetadata",
  "summarizeDeliveries",
  // audit-seam.ts — the injected audit seam (SEAM)
  "makeAurumAuditRecord",
  "NOOP_AURUM_AUDIT_SINK",
  "createInMemoryAurumAuditSink",
  "AURUM_AUDIT_ACTIONS",
  // index.ts — the module markers
  "MODULE_NAME",
  "MODULE_VERSION",
]);

test("the public value surface is EXACTLY the emission + ingestion allowlist", () => {
  const exported = Object.keys(aurum).sort();
  const expected = [...EXPECTED_EXPORTS].sort();
  expect(exported).toEqual(expected);
});

test("no export name suggests a domain mutation path", () => {
  // Note: `canTransitionDeliveryState` / `DELIVERY_STATE_TRANSITIONS` are
  // PURE read-only lifecycle helpers over the adapter's OWN delivery
  // metadata — not domain state mutations — so "transition" is not a
  // forbidden fragment here.
  const forbiddenFragments = [
    "dispatch",
    "execute",
    "approve",
    "reject",
    "wipe",
    "lock",
    "createdemand",
    "createworkorder",
    "opencase",
    "submit",
  ];
  for (const name of Object.keys(aurum)) {
    const lower = name.toLowerCase();
    for (const fragment of forbiddenFragments) {
      if (lower.includes(fragment)) {
        throw new Error(`authority boundary violated: export "${name}" matches "${fragment}"`);
      }
    }
  }
  expect(true).toBe(true);
});

test("the boundary functions take ONLY the adapter's own ledgers + injected seams (arity)", () => {
  // (ctx, outbox, intent, options?) — the optional trailing options is
  // the injected-sinks bag; the required params are the context, the
  // adapter's OWN ledger, and the pure builder output.
  expect(aurum.emitCommunicationMessage.length).toBe(3);
  // (ctx, outbox, ledger, input, options?)
  expect(aurum.ingestDeliveryMetadata.length).toBe(4);
});

test("src/ files import ONLY @fleetos/contracts and @fleetos/identity (never a domain package)", () => {
  const srcFiles = [
    "internal.ts",
    "audit-seam.ts",
    "content.ts",
    "intents.ts",
    "outbox.ts",
    "transport.ts",
    "emission.ts",
    "delivery.ts",
    "index.ts",
    "index.test.ts",
  ];
  const allowed = new Set(["@fleetos/contracts", "@fleetos/contracts/testing", "@fleetos/identity"]);
  const violations: string[] = [];
  for (const file of srcFiles) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    const specs = [...text.matchAll(/from\s+["'](@fleetos\/[^"']+)["']/g)].map((m) => m[1] as string);
    for (const spec of specs) {
      if (!allowed.has(spec)) {
        violations.push(`${file} imports ${spec}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

test("the package never re-exports a sibling domain package's surface", () => {
  const indexText = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
  expect(/export\s+\*\s+from\s+["']@fleetos\//.test(indexText)).toBe(false);
});

test("a full emission + ingestion round mutates ONLY the adapter's own ledgers (metadata-only)", () => {
  const outbox = aurum.createInMemoryOutboxLedger();
  const sink = aurum.createInMemoryAurumAuditSink();
  const ctx = { tenantId: "tnt_testtenant000a" as never };
  const built = aurum.buildMaintenanceNotice({
    recipient: { kind: "role", role: "fleet_manager" },
    at: "2026-02-01T00:00:00Z",
    correlationId: "cor_aurum_test_01" as never,
    workOrder: {
      workOrderId: "swo_boundary0001",
      tenantId: "tnt_testtenant000a" as never,
      deviceId: "dev_testdevice00a1" as never,
      revision: 1,
      serviceArea: "us-east-1",
      deadline: "2026-03-01T00:00:00Z",
      serviceCategory: "service.battery",
    },
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const emitted = aurum.emitCommunicationMessage(ctx, outbox, built.intent, {
    auditSink: sink,
    transport: aurum.createInMemoryTransport(),
  });
  if (!emitted.ok) throw new Error(emitted.error.message);
  const deliveries = aurum.createInMemoryDeliveryLedger();
  const outboxBefore = JSON.stringify(outbox.list(ctx));
  const ingested = aurum.ingestDeliveryMetadata(
    ctx,
    outbox,
    deliveries,
    {
      messageRef: emitted.entry.intent.messageId,
      deliveryAttempt: 1,
      state: "delivered",
      recipient: { recipientRef: "fleet_manager", channel: "email" },
      disposition: "succeeded",
      ingestedAt: "2026-03-01T00:00:00Z",
      correlationId: "cor_aurum_test_01" as never,
    },
    { auditSink: sink },
  );
  if (!ingested.ok) throw new Error(ingested.error.message);
  // The ONLY mutations: the delivery ledger (+1) and the audit trail.
  expect(deliveries.size(ctx)).toBe(1);
  expect(JSON.stringify(outbox.list(ctx))).toBe(outboxBefore); // the outbox entry was NOT rewritten
  expect(sink.records.map((r) => r.action)).toEqual([
    "aurum.message.emitted",
    "aurum.delivery.ingested",
  ]);
});
