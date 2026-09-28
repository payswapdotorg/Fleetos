/**
 * @fleetos/web-device — test-only ambient augmentation.
 *
 * The FleetOS workspace deliberately ships NO @types/bun beyond the
 * minimal shared `types/bun-test.d.ts` (a Tech-Lead decision; see that
 * file's header). These tests additionally use the numeric-comparison
 * matchers, so — exactly like the W050C aurum adapter's and the W051
 * convergence package's test-only ambient declarations — the interface
 * is augmented locally, inside this worker-a-owned package, keeping the
 * package-local typecheck strict and green.
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

export {};
