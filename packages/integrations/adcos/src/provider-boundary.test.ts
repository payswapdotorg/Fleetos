/**
 * @fleetos/integration-adcos — D2: the provider-neutral boundary tests.
 *
 * ARCHITECTURE-LOCK items 7-8 invariant: provider topology, native
 * credentials and provider SDK objects NEVER cross the boundary. The
 * only provider-originated value type is the OPAUSE provider handle (a
 * branded string). Everything the reference transport produces is
 * walked by the plain-data boundary check; denied keys, SDK objects,
 * functions and undefined holes are violations.
 */

import { test, expect } from "bun:test";
import {
  PROVIDER_NEUTRAL_DENIED_KEY_SUBSTRINGS,
  asAdcosProviderHandle,
  assertProviderNeutral,
  isProviderNeutral,
} from "./provider-boundary";
import type { AdcosTransportPort } from "./transport-seam";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import {
  CORR,
  DEV_A1,
  T0,
  connectivityIntent,
  localGuardian,
  ruleset,
  securePrivateRequirements,
} from "./test-support";
import { createInMemorySubmissionStore } from "./submission";
import { createInMemoryConnectivityRecordStore, adoptConnectivityStatus } from "./adoption";
import { submitConnectivityIntent } from "./submission-gate";
import { TENANT_A } from "./test-support";

// ---------------------------------------------------------------------------
// The opaque handle
// ---------------------------------------------------------------------------

test("the provider handle is an opaque branded string — no provider structure", () => {
  const handle = asAdcosProviderHandle("adcos-h-0123abcd");
  expect(typeof handle).toBe("string");
  expect(handle as string).toBe("adcos-h-0123abcd");
  // The handle is plain data — it satisfies the neutrality check.
  expect(isProviderNeutral(handle).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// The plain-data boundary check
// ---------------------------------------------------------------------------

test("plain JSON data is provider-neutral", () => {
  expect(isProviderNeutral(null).ok).toBe(true);
  expect(isProviderNeutral("text").ok).toBe(true);
  expect(isProviderNeutral(42).ok).toBe(true);
  expect(isProviderNeutral(true).ok).toBe(true);
  expect(isProviderNeutral({ a: 1, b: ["x", { c: "y" }] }).ok).toBe(true);
  expect(isProviderNeutral([]).ok).toBe(true);
});

test("functions never cross the boundary (SDK handles/closures)", () => {
  const check = isProviderNeutral({ callback: () => 1 });
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toBe("function_value");
});

test("class instances (provider SDK objects) never cross the boundary", () => {
  class SdkSession {
    public readonly state = "open";
  }
  const check = isProviderNeutral({ session: new SdkSession() });
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toBe("non_plain_object");
});

test("denied provider-metadata keys are violations at any depth", () => {
  for (const key of ["topology", "credentials", "sdkObject", "authToken", "secretKey", "apiKey", "endpointUrl", "hostname", "serviceUrl"]) {
    const check = isProviderNeutral({ nested: { [key]: "value" } });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("denied_key");
      expect(check.path).toContain(key);
    }
  }
});

test("undefined-valued keys are holes, not plain data", () => {
  const check = isProviderNeutral({ a: undefined });
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toBe("undefined_value");
});

test("cyclic references are refused (plain JSON data cannot cycle)", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const check = isProviderNeutral(cyclic);
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toBe("non_plain_object");
});

test("the denylist covers the provider-leak vocabulary", () => {
  const lowered = PROVIDER_NEUTRAL_DENIED_KEY_SUBSTRINGS.map((k) => k.toLowerCase());
  for (const required of ["topology", "credential", "sdk", "token", "secret", "password", "apikey", "privatekey", "endpoint", "hostname", "url"]) {
    expect(lowered).toContain(required);
  }
});

test("assertProviderNeutral throws with the machine-stable path + reason", () => {
  expect(() => assertProviderNeutral({ ok: true }, "probe")).not.toThrow();
  expect(() => assertProviderNeutral({ fn: () => 1 }, "probe")).toThrow(/function_value/);
});

// ---------------------------------------------------------------------------
// The reference transport stays neutral (structural typing + walk proofs)
// ---------------------------------------------------------------------------

test("the reference transport satisfies the neutral AdcosTransportPort structurally", () => {
  const transport: AdcosTransportPort = createInMemoryAdcosTransport();
  expect(typeof transport.submit).toBe("function");
  expect(typeof transport.fetchStatus).toBe("function");
  expect(typeof transport.terminate).toBe("function");
});

test("everything the reference transport produces is provider-neutral plain data (the boundary walk)", () => {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    securePrivateRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleset("ALLOW"),
      evaluator: localGuardian,
      transport,
    },
  );
  expect(result.ok).toBe(true);

  // The outbound request recorded by the transport.
  expect(transport.submissions.length).toBe(1);
  const neutrality = isProviderNeutral(transport.submissions[0].request);
  expect(neutrality.ok).toBe(true);
  if (!neutrality.ok) throw new Error(`${neutrality.path}: ${neutrality.detail}`);

  // The provider-side status report for the handle.
  if (result.ok && result.connectivityRecord !== null) {
    const report = transport.fetchStatus(result.connectivityRecord.handle, { at: T0, correlationId: CORR });
    expect(report).not.toBeNull();
    const reportNeutrality = isProviderNeutral(report);
    expect(reportNeutrality.ok).toBe(true);
  }
});

test("a non-neutral provider value is refused by the adoption path with provider_boundary — never recorded", () => {
  const recordStore = createInMemoryConnectivityRecordStore();
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" });
  const submitted = submitConnectivityIntent(
    { tenantId: intent.tenantId, correlationId: CORR },
    submissionStore,
    recordStore,
    intent,
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport },
  );
  expect(submitted.ok).toBe(true);
  if (!submitted.ok || submitted.connectivityRecord === null) throw new Error("setup failed");

  // A report smuggling an SDK object.
  const leaky = {
    connectivityId: submitted.connectivityRecord.connectivityId,
    handle: submitted.connectivityRecord.handle,
    executionState: "ACTIVE",
    acceptedRequirements: submitted.connectivityRecord.revisions[0].acceptedRequirements,
    measurements: [],
    degradation: { kind: "none" },
    failure: { kind: "none" },
    termination: null,
    reportedAt: T0,
    sdkObject: { toString: () => "leak" },
  };
  const adopted = adoptConnectivityStatus(
    { tenantId: intent.tenantId, correlationId: CORR },
    recordStore,
    leaky,
    { at: T0 },
  );
  expect(adopted.ok).toBe(false);
  if (!adopted.ok) {
    expect(adopted.error.code).toBe("adcos.report.invalid");
    expect(adopted.error.kind).toBe("ValidationError");
  }
  // No revision was appended.
  const after = recordStore.get({ tenantId: intent.tenantId, correlationId: CORR }, submitted.connectivityRecord.connectivityId);
  expect(after.ok).toBe(true);
  if (after.ok) expect(after.value.revisions.length).toBe(1);
});
