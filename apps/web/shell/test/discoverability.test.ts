import { test, expect } from "bun:test";
import {
  MATCH_RANK,
  bestMatch,
  buildSearchIndex,
  compareSearchResults,
  normalizeQuery,
  searchIndex,
  tokenize,
} from "../src/discoverability";
import { corpus, makeSummary } from "./helpers";

test("query normalization is deterministic (trim, lowercase, collapse)", () => {
  expect(normalizeQuery("  Fleet   OS  ")).toBe("fleet os");
  expect(normalizeQuery("")).toBe("");
});

test("tokenization drops empties and lowercases", () => {
  expect([...tokenize(" Mac   mini ")]).toEqual(["mac", "mini"]);
  expect(tokenize("   ")).toEqual([]);
});

test("match kinds rank in the frozen order", () => {
  expect(MATCH_RANK.title_exact).toBeGreaterThan(MATCH_RANK.keyword_exact);
  expect(MATCH_RANK.keyword_exact).toBeGreaterThan(MATCH_RANK.title_prefix);
  expect(MATCH_RANK.title_prefix).toBeGreaterThan(MATCH_RANK.keyword_prefix);
  expect(MATCH_RANK.keyword_prefix).toBeGreaterThan(MATCH_RANK.title_token);
  expect(MATCH_RANK.title_token).toBeGreaterThan(MATCH_RANK.keyword_token);
});

test("bestMatch returns the strongest match kind", () => {
  const entry = makeSummary("device", "dev-1", "Mac mini", ["desktop", "finance"]);
  expect(bestMatch(entry, "Mac mini")).toBe("title_exact");
  expect(bestMatch(entry, "finance")).toBe("keyword_exact");
  expect(bestMatch(entry, "Mac")).toBe("title_prefix");
  expect(bestMatch(entry, "fin")).toBe("keyword_prefix");
  expect(bestMatch(entry, "mini pro")).toBe("title_token");
  expect(bestMatch(entry, "finance audit")).toBe("keyword_token");
  expect(bestMatch(entry, "nothing")).toBe(null);
});

test("empty and blank queries refuse machine-stably", () => {
  const index = buildSearchIndex(corpus());
  expect(searchIndex(index, "")).toEqual({ ok: false, reason: "empty_query" });
  expect(searchIndex(index, "   ")).toEqual({ ok: false, reason: "blank_query" });
});

test("search ranks deterministically: exact beats prefix; ties by area/recordId", () => {
  const index = buildSearchIndex([
    makeSummary("device", "dev-9", "Keyboard dock", ["keyboard"]),
    makeSummary("commerce", "po-1", "Keyboard procurement", ["keyboard"]),
    makeSummary("commerce", "po-0", "Keyboard", ["keyboard"]),
    makeSummary("actions", "plan-1", "Rotate credentials plan", ["credentials"]),
  ]);
  const outcome = searchIndex(index, "keyboard");
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  // The exact title match wins; the two prefix matches tie at rank 60 and
  // break by (area asc, recordId asc):
  expect(outcome.results[0]!.match).toBe("title_exact");
  expect(outcome.results[0]!.entry.recordId).toBe("po-0");
  expect(outcome.results.map((r) => `${r.entry.area}:${r.entry.recordId}`)).toEqual([
    "commerce:po-0",
    "commerce:po-1",
    "device:dev-9",
  ]);
  expect(outcome.results.every((r) => r.entry.recordId !== "plan-1")).toBe(true);
});

test("search is byte-stable across repeated runs and input permutations", () => {
  const a = buildSearchIndex(corpus());
  const b = buildSearchIndex([...corpus()].reverse());
  const r1 = searchIndex(a, "keyboard");
  const r2 = searchIndex(b, "keyboard");
  expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  const again = searchIndex(a, "keyboard");
  expect(JSON.stringify(r1)).toBe(JSON.stringify(again));
});

test("compareSearchResults orders rank desc then area then recordId", () => {
  const mk = (area: "device" | "security", recordId: string, rank: number) => ({
    entry: makeSummary(area, recordId, "t", ["k"]),
    match: "keyword_token" as const,
    rank,
  });
  expect(compareSearchResults(mk("device", "a", 30), mk("device", "a", 40))).toBeGreaterThan(0);
  expect(compareSearchResults(mk("device", "b", 40), mk("device", "a", 40))).toBeGreaterThan(0);
  expect(compareSearchResults(mk("security", "a", 40), mk("device", "b", 40))).toBeGreaterThan(0);
});

test("the built index is frozen", () => {
  const index = buildSearchIndex(corpus());
  expect(Object.isFrozen(index)).toBe(true);
});
