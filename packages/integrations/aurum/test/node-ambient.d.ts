/**
 * W050C aurum adapter — test-only ambient declarations.
 *
 * The FleetOS workspace deliberately ships NO @types/node and NO bun
 * types beyond the minimal `types/bun-test.d.ts` (a Tech-Lead decision;
 * see that file's header). These tests read the package's own src/
 * files to assert the authority-boundary import discipline, which
 * needs three tiny ambient surfaces: `node:fs.readFileSync`,
 * `node:path.join` and `import.meta.dir` (a Bun extension). Declared
 * here — inside this package's lane — so the package typecheck stays
 * strict without touching shared workspace files.
 *
 * Test-file only; never imported by src/.
 */

declare module "bun:test" {
  // Local augmentation of the minimal ambient declarations (the shared
  // types/bun-test.d.ts intentionally declares only the W001 surface;
  // these tests additionally use the numeric-comparison matchers).
  interface Expect<T> {
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
  }
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare global {
  interface ImportMeta {
    /** The directory of the current module (a Bun extension). */
    readonly dir: string;
  }
}

export {};
