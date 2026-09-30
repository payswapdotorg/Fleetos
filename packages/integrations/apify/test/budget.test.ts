/**
 * W100C — the budget guard: integer-cent discipline, refusal leaves the
 * ledger unchanged, release semantics.
 */

import { test, expect } from "bun:test";
import { createInMemoryUsageLedger } from "../src/index";

test("the reference ledger starts at the Apify Free $5 credit (500 cents)", () => {
  const ledger = createInMemoryUsageLedger();
  expect(ledger.remainingCents).toBe(500);
});

test("reservations decrement atomically and report the remainder", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 100 });
  const first = ledger.checkAndReserve(25);
  expect(first.ok).toBe(true);
  if (first.ok) expect(first.remainingCents).toBe(75);
  const second = ledger.checkAndReserve(25);
  expect(second.ok).toBe(true);
  if (second.ok) expect(second.remainingCents).toBe(50);
  expect(ledger.remainingCents).toBe(50);
});

test("a refused reservation leaves the ledger UNCHANGED (never partial)", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 30 });
  const refused = ledger.checkAndReserve(50);
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.reason).toBe("budget_exhausted");
    expect(refused.remainingCents).toBe(30);
  }
  expect(ledger.remainingCents).toBe(30);
});

test("the exact-credit boundary: a run costing exactly the remainder succeeds once", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 25 });
  expect(ledger.checkAndReserve(25).ok).toBe(true);
  expect(ledger.remainingCents).toBe(0);
  expect(ledger.checkAndReserve(25).ok).toBe(false);
});

test("release restores the cost without exceeding the initial credit", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 100 });
  ledger.checkAndReserve(40);
  ledger.release(40);
  expect(ledger.remainingCents).toBe(100);
  // Releasing more than was reserved cannot exceed the initial credit.
  ledger.release(40);
  expect(ledger.remainingCents).toBe(100);
});

test("invalid costs are refused without side effects", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 100 });
  expect(ledger.checkAndReserve(0).ok).toBe(false);
  expect(ledger.checkAndReserve(-5).ok).toBe(false);
  expect(ledger.checkAndReserve(2.5).ok).toBe(false);
  expect(ledger.remainingCents).toBe(100);
  ledger.release(0);
  ledger.release(-3);
  expect(ledger.remainingCents).toBe(100);
});
