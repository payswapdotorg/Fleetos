/**
 * W100C apify adapter — test-only ambient declarations.
 *
 * The FleetOS workspace deliberately ships NO @types/node and NO bun
 * types beyond the minimal `types/bun-test.d.ts` (a Tech-Lead decision;
 * see that file's header — the aurum adapter declares the same minimal
 * surfaces). These tests read the package's own src/ files to assert the
 * authority-boundary import discipline, which needs three tiny ambient
 * surfaces: `node:fs.readFileSync`, `node:path.join` and `import.meta.dir`
 * (a Bun extension).
 *
 * Test-file only; never imported by src/.
 */

declare module "bun:test" {
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
