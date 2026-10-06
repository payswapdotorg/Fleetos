/**
 * W154 world-model — test-only ambient declarations.
 *
 * The FleetOS workspace deliberately ships NO @types/node and NO bun
 * types beyond the minimal `types/bun-test.d.ts` (a Tech-Lead
 * decision). These tests read the package's own src/ files to assert
 * the src discipline, which needs one tiny ambient surface beyond
 * the shared declarations: `import.meta.dir` (a Bun extension).
 * Declared here — inside this worker-b-owned package — so the root
 * typecheck stays strict without touching shared workspace files
 * (exactly the W153 predictive pattern and the W070 learning pattern).
 *
 * Test-file only; never imported by src/.
 */

declare global {
  interface ImportMeta {
    /** The directory of the current module (a Bun extension). */
    readonly dir: string;
  }
}

export {};
