/**
 * @fleetos/world-context — test-only ambient augmentation.
 *
 * The FleetOS workspace deliberately ships NO @types/bun beyond the
 * minimal shared `types/bun-test.d.ts` (a Tech-Lead decision). The
 * contract-conformance test additionally uses `node:fs.readFileSync` +
 * `node:path.join` (re-declared by the shared `types/bun-test.d.ts`).
 *
 * Test-file only; never imported by src/.
 */
