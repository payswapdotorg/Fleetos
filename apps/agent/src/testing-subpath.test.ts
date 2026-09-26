import { test, expect } from "bun:test";
import {
  makeTenantId,
  makeDeviceId,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAdapterCapabilities,
  makeGuardianDecision,
  makeFleetError,
  ALLOW,
  BLOCK,
  MAINTAIN_DEVICE_INTENT_KIND,
} from "@fleetos/contracts/testing";

/**
 * Cross-package consumer proof for `@fleetos/contracts/testing` subpath.
 *
 * This file lives in `apps/agent` (worker-a lane). It imports ONLY from
 * `@fleetos/contracts/testing` — the test-only subpath exported by the
 * Tech-Lead-owned `@fleetos/contracts` package. The import-boundary gate
 * (`tools/check-ownership.mjs`) allows imports of `@fleetos/contracts` and
 * its subpaths from any lane; this test proves the subpath resolves cleanly
 * from another workspace package's test directory.
 *
 * The test file is intentionally read-only: it does NOT modify any
 * worker-a-owned source file or contract. It exists solely to prove that
 * Wave 1 lanes (W010/W011/W012) can consume the testing subpath without
 * import-boundary violations.
 *
 * Per W003 D5: "the testing subpath imports cleanly from another package's
 * test (prove it with a tiny consumer test in apps/agent or apps/web test
 * dir — read-only use of another lane's test dir is allowed for this proof;
 * note it in the report)."
 */
test("@fleetos/contracts/testing: subpath resolves from another lane's test directory", () => {
  // Each fixture builder is callable and produces a value.
  const tenant = makeTenantId("agent-consumer");
  expect(typeof tenant).toBe("string");
  expect(tenant.startsWith("tnt_")).toBe(true);

  const device = makeDeviceId("agent-consumer");
  expect(device.startsWith("dev_")).toBe(true);

  const event = makeEventEnvelope({ tenantId: tenant, subject: device });
  expect(event.tenantId).toBe(tenant);
  expect(event.subject).toBe(device);

  const cmd = makeCommandEnvelope({ tenantId: tenant });
  expect(cmd.tenantId).toBe(tenant);
  expect(typeof cmd.idempotencyKey).toBe("string");
  expect(cmd.idempotencyKey.length).toBeGreaterThan(0);

  const intent = makeIntent(MAINTAIN_DEVICE_INTENT_KIND, { tenantId: tenant });
  expect(intent.tenantId).toBe(tenant);
  expect(intent.payload.kind).toBe(MAINTAIN_DEVICE_INTENT_KIND);

  const caps = makeAdapterCapabilities(["identify", "health"], ["wipe"]);
  expect(caps.identify).toBe(true);
  expect(caps.health).toBe(true);
  expect(caps.wipe).toBe(false);

  const allowDecision = makeGuardianDecision(ALLOW);
  expect(allowDecision.decision).toBe(ALLOW);

  const blockDecision = makeGuardianDecision(BLOCK);
  expect(blockDecision.decision).toBe(BLOCK);

  const err = makeFleetError("DomainError");
  expect(err.kind).toBe("DomainError");
});

test("@fleetos/contracts/testing: fixtures are deterministic from the consumer's perspective too", () => {
  // The same seed must produce the same value regardless of which package
  // imports the subpath. This proves the determinism is a property of the
  // fixture builders, not of the consuming module.
  const a = makeTenantId("determinism-proof");
  const b = makeTenantId("determinism-proof");
  expect(a).toBe(b);
});
