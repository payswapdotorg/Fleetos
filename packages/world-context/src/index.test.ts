/**
 * @fleetos/world-context — the public-API smoke test (the W154 pattern).
 *
 * The full test battery lives in `test/`:
 *   - determinism.test.ts          golden contexts + golden proposals (byte-identical outputs)
 *   - honesty.test.ts              the empty-surface minimal context; the non-ok prediction REFUSED; missing-provenance REFUSAL; cross-tenant REFUSED everywhere
 *   - proposal-gate.test.ts        the proposal-gate law (ALLOW→PROPOSED, WARN→PROPOSED, REQUIRE_APPROVAL→PARKED, BLOCK→REJECTED); the bridge NEVER submits (no submit path exists — machine-tested)
 *   - counterfactual-visibility.test.ts  the hypothetical marker survives conversion (THREE surfaces)
 *   - outcome-binding.test.ts      the observed-vs-predicted join; horizon-mismatch REFUSES; provenance chain verified
 *   - contract-conformance.test.ts  the src-discipline + frozen-surface checks (machine-enforced)
 *   - binding.test.ts              the projection over the REAL workloads/procurement public types; the bridge into the REAL learning package's proposal shapes; the outcome binding into the REAL outcome-observation shapes; the REAL @fleetos/audit sink
 */

import { test, expect } from "bun:test";
import { MODULE_NAME, MODULE_VERSION } from "./index";

test("MODULE_NAME/MODULE_VERSION markers are exported (the skeleton contract)", () => {
  expect(MODULE_NAME).toBe("world-context");
  expect(MODULE_VERSION).toBe("0.1.0");
});
