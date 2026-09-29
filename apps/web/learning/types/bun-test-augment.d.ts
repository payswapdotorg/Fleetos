/**
 * @fleetos/web-learning — test-only ambient declarations.
 *
 * The FleetOS workspace deliberately ships NO @types/node and NO bun
 * types beyond the minimal `types/bun-test.d.ts` (a Tech-Lead
 * decision; see that file's header). These tests additionally use:
 *   - the numeric-comparison matchers (the W050C/W051 augmentation),
 *   - `node:fs.readFileSync` / `node:fs.readdirSync` and
 *     `node:path.join` (src-discipline style checks read the lane's
 *     own src/ files),
 *   - `import.meta.dir` (a Bun extension).
 * Declared here — inside this worker-b-owned surface lane — so the
 * lane-local typecheck stays strict without touching shared
 * workspace files (exactly the W050C aurum adapter's pattern).
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
  export function readdirSync(path: string): string[];
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
