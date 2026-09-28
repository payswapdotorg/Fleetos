/**
 * W061 web-shell — test-only ambient declarations.
 *
 * Same pattern as the sibling UI lanes (the W050C/W060 precedent): the
 * workspace ships NO @types/node and only the minimal root
 * `types/bun-test.d.ts`; these tests additionally use:
 *   - the numeric-comparison matchers,
 *   - `node:fs.readFileSync` / `node:fs.readdirSync` and `node:path.join`
 *     (the src-discipline tests read the lane's own src/ files),
 *   - `import.meta.dir` (a Bun extension).
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

declare global {
  interface ImportMeta {
    /** The directory of the current module (a Bun extension). */
    readonly dir: string;
  }
}

export {};
