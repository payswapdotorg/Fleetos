/**
 * W060C web-commerce — the provider-neutrality boundary tests
 * (ARCHITECTURE-LOCK items 6-8).
 *
 * The connectivity + communication surfaces display provider-neutral
 * data ONLY: no provider topology, no credentials, no SDK objects, no
 * opaque provider handles, no provider-originated message handles. These
 * tests walk EVERY view-model the surfaces produce (serialized to JSON)
 * against the machine-stable denied-key denylist — the same discipline
 * as the W050A provider boundary, enforced at the SURFACE level.
 */

import { test, expect } from "bun:test";
import {
  buildConnectivityRequestView,
  buildConnectivitySubmissionListView,
  buildConnectivityTimelineView,
  buildOutboxListView,
  buildDeliveryTimelineView,
  buildCommunicationSummaryView,
} from "../src/index";
import {
  TENANT_A,
  realConnectivityRecord,
  realDeliveryRecords,
  realOutboxApprovalEntry,
  realOutboxEntry,
  realParkedSubmission,
} from "./helpers";

/**
 * The denied key substrings — provider topology, credentials, SDK
 * objects, opaque handles. Matched case-insensitively against every
 * object KEY at every depth of the serialized views (mirrors the W050A
 * `PROVIDER_NEUTRAL_DENIED_KEY_SUBSTRINGS` denylist + the surface-local
 * additions `handle` and `providerMessageId`).
 */
const DENIED_KEY_SUBSTRINGS: readonly string[] = Object.freeze([
  "topology",
  "credential",
  "sdk",
  "token",
  "secret",
  "password",
  "apikey",
  "privatekey",
  "endpoint",
  "hostname",
  "url",
  "handle",
  "providermessageid",
]);

/** Recursively collect every object key at every depth. */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key.toLowerCase());
    collectKeys(child, keys);
  }
}

/** Assert no denied key substring appears anywhere in the view's keys. */
function assertProviderNeutral(view: unknown, label: string): void {
  const keys = new Set<string>();
  collectKeys(view, keys);
  for (const denied of DENIED_KEY_SUBSTRINGS) {
    for (const key of keys) {
      if (key.includes(denied)) {
        throw new Error(`${label}: view carries denied provider key "${key}" (matched "${denied}")`);
      }
    }
  }
}

test("the connectivity request view is provider-neutral (no handles/topology/credentials)", () => {
  const result = buildConnectivityRequestView(TENANT_A, realParkedSubmission());
  if (!result.ok) throw new Error(result.error.message);
  assertProviderNeutral(result.view, "connectivity request view");
  // The submission record itself CARRIES a provider handle field on the
  // real record shape — the view must never project it.
  const serialized = JSON.stringify(result.view);
  expect(serialized.includes("opq_")).toBe(false);
});

test("the connectivity timeline view is provider-neutral", () => {
  const result = buildConnectivityTimelineView(TENANT_A, realConnectivityRecord());
  if (!result.ok) throw new Error(result.error.message);
  assertProviderNeutral(result.view, "connectivity timeline view");
  expect(JSON.stringify(result.view).includes("opq_provider_handle")).toBe(false);
});

test("the submission list view is provider-neutral", () => {
  const result = buildConnectivitySubmissionListView(TENANT_A, [realParkedSubmission()]);
  if (!result.ok) throw new Error(result.error.message);
  assertProviderNeutral(result.view, "submission list view");
});

test("the outbox + delivery + summary views are metadata-only (no provider message handles)", () => {
  const outbox = buildOutboxListView(TENANT_A, [realOutboxEntry(), realOutboxApprovalEntry()]);
  if (!outbox.ok) throw new Error(outbox.error.message);
  assertProviderNeutral(outbox.view, "outbox view");

  const delivery = buildDeliveryTimelineView(TENANT_A, "aurum_msg_w060c0001", realDeliveryRecords());
  if (!delivery.ok) throw new Error(delivery.error.message);
  assertProviderNeutral(delivery.view, "delivery view");

  const summary = buildCommunicationSummaryView(
    TENANT_A,
    [realOutboxEntry(), realOutboxApprovalEntry()],
    realDeliveryRecords(),
  );
  if (!summary.ok) throw new Error(summary.error.message);
  assertProviderNeutral(summary.view, "communication summary view");
});

test("the surfaces expose no mutation entry points (read-only projections)", async () => {
  // The public surface must contain ONLY: pure builders, pure derivations,
  // frozen constants, typed facets, and state-machine reducers. Assert the
  // module surface has NO function whose name suggests mutation
  // (append/emit/submit/accept/ingest/create/write/update/delete/dispatch).
  const module = await import("../src/index");
  const mutators: string[] = [];
  for (const [name, value] of Object.entries(module)) {
    if (typeof value === "function") {
      if (/^(append|emit|submit|accept|ingest|create|write|update|delete|dispatch|put|post|send|revise|approve|reject|supersede|terminate|adopt)/i.test(name)) {
        mutators.push(name);
      }
    }
  }
  expect(mutators).toEqual([]);
});

test("the provider refusal is surfaced as the machine-stable REASON only", async () => {
  // Build a submission record whose head revision carries a typed provider
  // refusal with a DETAIL that would leak provider specifics — the view
  // must surface the reason and NEVER the detail.
  const submission = realParkedSubmission();
  const head = submission.revisions[submission.revisions.length - 1];
  if (head === undefined) throw new Error("no head revision");
  const refused: typeof submission = {
    ...submission,
    status: "REJECTED",
    revisions: [
      ...submission.revisions,
      {
        ...head,
        revision: head.revision + 1,
        status: "REJECTED",
        providerRefusal: {
          reason: "unsupported_outcome",
          detail: "provider topology endpoint https://adcos.example.internal/paths",
        },
      },
    ],
  };
  const result = buildConnectivityRequestView(TENANT_A, refused);
  if (!result.ok) throw new Error(result.error.message);
  const serialized = JSON.stringify(result.view);
  expect(serialized.includes("unsupported_outcome")).toBe(true);
  expect(serialized.includes("adcos.example.internal")).toBe(false);
  expect(serialized.includes("https")).toBe(false);
});
