import { test, expect } from "bun:test";
import { assertVersion, makeVersioned, MIN_SCHEMA_VERSION, type Versioned } from "../src/versioning";

test("MIN_SCHEMA_VERSION is 1 (zero is reserved for unspecified)", () => {
  expect(MIN_SCHEMA_VERSION).toBe(1);
});

test("makeVersioned returns a frozen record with the payload and version", () => {
  const v = makeVersioned({ hello: "world" }, 1);
  expect(Object.isFrozen(v)).toBe(true);
  expect(v.schemaVersion).toBe(1);
  expect(v.data).toEqual({ hello: "world" });
});

test("assertVersion: known version returns ok:true", () => {
  const v = makeVersioned({}, 1);
  const result = assertVersion(v, [1, 2]);
  expect(result).toEqual({ ok: true, schemaVersion: 1 });
});

test("assertVersion: schemaVersion below 1 returns ok:false with reason=version_below_one", () => {
  // Bypass the constructor (which doesn't enforce) to test the validator.
  const v = { schemaVersion: 0, data: {} } as Versioned<unknown>;
  const result = assertVersion(v, [1]);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("version_below_one");
    expect(result.received).toBe(0);
  }
});

test("assertVersion: unknown version returns ok:false with reason=version_unknown_to_consumer", () => {
  const v = makeVersioned({}, 3);
  const result = assertVersion(v, [1, 2]);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("version_unknown_to_consumer");
    expect(result.received).toBe(3);
  }
});

test("assertVersion: known versions list with multiple entries accepts matching version", () => {
  const v = makeVersioned({}, 2);
  expect(assertVersion(v, [1, 2, 3])).toEqual({ ok: true, schemaVersion: 2 });
});

test("assertVersion: consumer must explicitly list every version it understands", () => {
  // A consumer that only knows version 1 must reject version 2 — even if
  // the version is valid in absolute terms (>= 1). The point is forward
  // compatibility: the consumer refuses to interpret a version it doesn't
  // understand rather than silently misinterpret it.
  const v = makeVersioned({}, 2);
  const result = assertVersion(v, [1]);
  expect(result.ok).toBe(false);
});

test("assertVersion: negative version is rejected", () => {
  const v = { schemaVersion: -1, data: {} } as Versioned<unknown>;
  const result = assertVersion(v, [1, 2]);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("version_below_one");
  }
});
