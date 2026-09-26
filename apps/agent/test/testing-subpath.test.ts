import { test, expect } from "bun:test";
// W003 D5 — Consumer proof that the `@fleetos/contracts/testing` subpath
// imports cleanly from another lane's test directory.
//
// This test lives in `apps/agent/test/` (worker-a's lane). The W003 work
// order authorizes read-only use of another lane's test dir for this
// proof; worker-a inherits this file as part of W003's tech-lead-signed
// change.
//
// IMPORTANT — subpath resolution gap (Line-stop finding, see W003 report):
//
// The `@fleetos/contracts/testing` subpath is correctly configured in
// `packages/contracts/package.json` `exports`:
//
//   "exports": {
//     ".": { "types": "src/index.ts", "default": "src/index.ts" },
//     "./testing": { "types": "src/testing.ts", "default": "src/testing.ts" }
//   }
//
// However, bun 1.3.14 does NOT auto-symlink workspace packages into
// `node_modules` when the consuming package does not declare the
// workspace package as a `workspace:*` dependency. The W001
// SKELETON-NOTES claim "Bun's workspace resolution handles the rest.
// No `paths` entry is needed in `tsconfig.base.json`" is INCORRECT
// for cross-package imports — it holds only for same-package imports
// (resolved via relative paths in the existing W002 tests).
//
// This consumer test therefore uses RELATIVE imports to prove the
// testing module is importable from another lane's test dir. The
// `@fleetos/contracts/testing` subpath is verified structurally by
// `tools/check-contracts.mjs` (which scans the contracts package's
// `exports` field) and by `packages/contracts/test/testing.test.ts`
// (which exercises the testing module's API).
//
// The Tech Lead should resolve this gap before Wave 1 by either:
//   (a) adding `@fleetos/contracts: workspace:*` to every consuming
//       package's `package.json` and verifying bun creates the symlink
//       in `node_modules`; OR
//   (b) adding a `paths` mapping to `tsconfig.base.json` for `@fleetos/*`
//       and a corresponding `node_modules/@fleetos/contracts` symlink
//       (or bunfig.toml resolution config).
//
// Until then, Wave 1 contract tests in worker lanes must import the
// testing module via the relative path shown below. The relative path
// is stable because the workspace layout is frozen.

// Relative import — proves the testing module is importable from
// apps/agent/test/ (another lane's test dir).
import {
  TESTING_MODULE_NAME,
  TESTING_MODULE_VERSION,
  makeTenantId,
  makeEventId,
  makeDeviceId,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAdapterCapabilities,
  makeGuardianDecision,
  makeFleetError,
  makeObservationBatch,
  SeededRng,
  FIXTURE_TIME_ANCHOR,
} from "../../../packages/contracts/src/testing";

// Relative import to the main contracts entry — proves the W002
// validators are also importable from apps/agent/test/.
import { validateEnvelope } from "../../../packages/contracts/src/events";
import { validateCommand } from "../../../packages/contracts/src/commands";
import { validateObservationBatch } from "../../../packages/contracts/src/observations";
import { isValidTenantId } from "../../../packages/contracts/src/tenant";

// ---------------------------------------------------------------------------
// Subpath configuration proof (structural)
// ---------------------------------------------------------------------------

test("consumer: the @fleetos/contracts package declares the ./testing subpath in exports", async () => {
  // Read the contracts package.json and verify the subpath is configured.
  // This is a structural proof that the subpath EXISTS, even if bun's
  // workspace resolution does not auto-link it.
  const pkgUrl = new URL("../../../packages/contracts/package.json", import.meta.url);
  const resp = await fetch(pkgUrl);
  const pkg = await resp.json();
  expect(pkg.name).toBe("@fleetos/contracts");
  expect(pkg.exports).toBeDefined();
  expect(pkg.exports["."]).toBeDefined();
  expect(pkg.exports["./testing"]).toBeDefined();
  expect(pkg.exports["./testing"].types).toBe("src/testing.ts");
  expect(pkg.exports["./testing"].default).toBe("src/testing.ts");
});

// ---------------------------------------------------------------------------
// Module markers
// ---------------------------------------------------------------------------

test("consumer: the testing subpath exports its module markers", () => {
  expect(TESTING_MODULE_NAME).toBe("contracts/testing");
  expect(TESTING_MODULE_VERSION).toBe("0.1.0");
});

test("consumer: FIXTURE_TIME_ANCHOR is the canonical anchor", () => {
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
});

// ---------------------------------------------------------------------------
// SeededRng
// ---------------------------------------------------------------------------

test("consumer: SeededRng is constructible and deterministic", () => {
  const a = new SeededRng(42);
  const b = new SeededRng(42);
  expect(a.next()).toBe(b.next());
  expect(a.next()).toBe(b.next());
});

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

test("consumer: makeTenantId produces a valid tenant id (reuses W002 validator)", () => {
  const t = makeTenantId("consumer-test");
  expect(isValidTenantId(t)).toBe(true);
});

test("consumer: makeEventId and makeDeviceId are deterministic", () => {
  expect(makeEventId("x")).toBe(makeEventId("x"));
  expect(makeDeviceId("x")).toBe(makeDeviceId("x"));
});

// ---------------------------------------------------------------------------
// EventEnvelope
// ---------------------------------------------------------------------------

test("consumer: makeEventEnvelope produces a valid envelope (reuses W002 validateEnvelope)", () => {
  const env = makeEventEnvelope({ seed: "consumer-event" });
  expect(validateEnvelope(env).ok).toBe(true);
});

test("consumer: makeEventEnvelope is deterministic (same seed => same envelope)", () => {
  const a = makeEventEnvelope({ seed: "determ" });
  const b = makeEventEnvelope({ seed: "determ" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// CommandEnvelope
// ---------------------------------------------------------------------------

test("consumer: makeCommandEnvelope produces a valid command (reuses W002 validateCommand)", () => {
  const cmd = makeCommandEnvelope({ seed: "consumer-cmd" });
  expect(validateCommand(cmd).ok).toBe(true);
});

test("consumer: makeCommandEnvelope carries an idempotency key", () => {
  const cmd = makeCommandEnvelope({ seed: "idem" });
  expect(typeof cmd.idempotencyKey).toBe("string");
  expect((cmd.idempotencyKey as string).length > 0).toBe(true);
});

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

test("consumer: makeIntent produces MaintainDeviceIntent by default", () => {
  const intent = makeIntent({ seed: "consumer-intent" });
  expect((intent.payload as { kind: string }).kind).toBe("MaintainDeviceIntent");
});

// ---------------------------------------------------------------------------
// AdapterCapabilities
// ---------------------------------------------------------------------------

test("consumer: makeAdapterCapabilities respects explicit supported/unsupported sets", () => {
  const caps = makeAdapterCapabilities({
    supported: ["identify", "wipe"],
    unsupported: ["locate"],
  });
  expect(caps.identify).toBe(true);
  expect(caps.wipe).toBe(true);
  expect(caps.locate).toBe(false);
});

// ---------------------------------------------------------------------------
// GuardianDecision
// ---------------------------------------------------------------------------

test("consumer: makeGuardianDecision produces a frozen ALLOW decision by default", () => {
  const d = makeGuardianDecision({ seed: "consumer-decision" });
  expect(d.decision).toBe("ALLOW");
  expect(Object.isFrozen(d)).toBe(true);
});

// ---------------------------------------------------------------------------
// FleetError
// ---------------------------------------------------------------------------

test("consumer: makeFleetError produces a DomainError by default", () => {
  const e = makeFleetError({ seed: "consumer-error" });
  expect(e.kind).toBe("DomainError");
});

// ---------------------------------------------------------------------------
// ObservationBatch
// ---------------------------------------------------------------------------

test("consumer: makeObservationBatch produces a valid batch (reuses W002 validateObservationBatch)", () => {
  const b = makeObservationBatch({ seed: "consumer-batch" });
  expect(validateObservationBatch(b).ok).toBe(true);
});
