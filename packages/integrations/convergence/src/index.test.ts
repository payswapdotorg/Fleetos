import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION, canonicalJson, fnv1a32Hex } from "./index";

test("MODULE_NAME/MODULE_VERSION markers are exported (the skeleton contract)", () => {
  expect(MODULE_NAME).toBe("integration-convergence");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("canonicalJson is deterministic under key-order permutations", () => {
  const a = canonicalJson({ b: 1, a: { z: true, y: [1, "x", null] } });
  const b = canonicalJson({ a: { y: [1, "x", null], z: true }, b: 1 });
  expect(a).toBe(b);
});

test("fnv1a32Hex is deterministic and hex-encoded", () => {
  expect(fnv1a32Hex("fleetos")).toBe(fnv1a32Hex("fleetos"));
  expect(fnv1a32Hex("fleetos")).toMatch(/^[0-9a-f]{8}$/);
  expect(fnv1a32Hex("fleetos")).not.toBe(fnv1a32Hex("fleetos2"));
});
