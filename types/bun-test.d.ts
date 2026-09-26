// Minimal ambient declaration for the bun:test module.
//
// Sufficient for W001 placeholder tests (which only call test() and expect())
// plus W003 contract-test fixtures (which also call toBeGreaterThan /
// toBeGreaterThanOrEqual on numeric invariants like schemaVersion). When
// @types/bun is added in a later wave, this file should be deleted and
// replaced with the canonical @types/bun package.
//
// This file declares ONLY the bun:test API surface used by tests in this
// repo. It does NOT introduce any domain types, event schemas, or contracts.
declare module "bun:test" {
  export type TestFn = () => void | Promise<void>;

  export function test(name: string, fn: TestFn): void;
  export function test(name: string, options: { only?: boolean; skip?: boolean; todo?: boolean }, fn: TestFn): void;
  export namespace test {
    function skip(name: string, fn: TestFn): void;
    function only(name: string, fn: TestFn): void;
    function todo(name: string, fn?: TestFn): void;
  }

  export interface Expect<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNaN(): void;
    toBeInstanceOf(expected: unknown): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toThrow(expected?: unknown): void;
    readonly not: Expect<T>;
    resolves: Promise<Expect<T>>;
    rejects: Promise<Expect<T>>;
  }

  export function expect<T>(actual: T): Expect<T>;

  export function describe(name: string, fn: () => void | Promise<void>): void;
  export namespace describe {
    function skip(name: string, fn: () => void | Promise<void>): void;
    function only(name: string, fn: () => void | Promise<void>): void;
    function todo(name: string, fn?: () => void | Promise<void>): void;
  }

  export const it: typeof test;
  export const beforeAll: (fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterAll: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;

  export function mock<T extends (...args: any[]) => any>(fn: T): T & {
    mock: {
      calls: Parameters<T>[];
      results: ReturnType<T>[];
      lastCall: Parameters<T>;
      clear(): void;
      reset(): void;
    };
  };
}
