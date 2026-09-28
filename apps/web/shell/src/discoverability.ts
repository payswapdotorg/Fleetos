/**
 * @fleetos/web-shell — discoverability (deterministic cross-surface search).
 *
 * A frozen search index over injected record summaries; ranking is
 * fully deterministic (no scores from unstable sources, no clock, no
 * frequency counting): exact title > exact keyword > title prefix >
 * keyword prefix > token containment; ties broken by (area, recordId)
 * total order. Empty/blank queries refuse machine-stably — the shell
 * never returns an implicit "everything" listing.
 */
import type { ShellRecordSummary } from "./seams";
import { compareStrings, frozenArray } from "./internal";

/** Why an entry matched (the machine-stable score reason). */
export type MatchKind =
  | "title_exact"
  | "keyword_exact"
  | "title_prefix"
  | "keyword_prefix"
  | "title_token"
  | "keyword_token";

/** Frozen per-kind rank (higher wins). */
export const MATCH_RANK: Readonly<Record<MatchKind, number>> = {
  title_exact: 100,
  keyword_exact: 80,
  title_prefix: 60,
  keyword_prefix: 50,
  title_token: 40,
  keyword_token: 30,
};

/** A ranked search result. */
export interface ShellSearchResult {
  readonly entry: ShellRecordSummary;
  readonly match: MatchKind;
  readonly rank: number;
}

export type ShellSearchOutcome =
  | { readonly ok: true; readonly results: readonly ShellSearchResult[] }
  | { readonly ok: false; readonly reason: "empty_query" | "blank_query" };

/** Normalize a query: trim, lowercase, collapse internal whitespace. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tokenize normalized text (space-separated, empty tokens dropped). */
export function tokenize(text: string): readonly string[] {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) return [];
  return frozenArray(normalized.split(" ").filter((t) => t.length > 0));
}

/** The best match kind of an entry for a normalized query (or null). */
export function bestMatch(entry: ShellRecordSummary, query: string): MatchKind | null {
  const q = normalizeQuery(query);
  if (q.length === 0) return null;
  const title = entry.title.trim().toLowerCase();
  if (title === q) return "title_exact";
  if (entry.keywords.some((k) => k.toLowerCase() === q)) return "keyword_exact";
  if (title.startsWith(q)) return "title_prefix";
  if (entry.keywords.some((k) => k.toLowerCase().startsWith(q))) return "keyword_prefix";
  const qTokens = new Set(tokenize(q));
  const titleTokens = new Set(tokenize(title));
  for (const token of qTokens) {
    if (titleTokens.has(token)) return "title_token";
  }
  for (const keyword of entry.keywords) {
    const keywordTokens = new Set(tokenize(keyword));
    for (const token of qTokens) {
      if (keywordTokens.has(token)) return "keyword_token";
    }
  }
  return null;
}

/** Machine-stable result ordering: rank desc, then area, then recordId. */
export function compareSearchResults(a: ShellSearchResult, b: ShellSearchResult): number {
  if (b.rank !== a.rank) return b.rank - a.rank;
  const areaDelta = compareStrings(a.entry.area, b.entry.area);
  if (areaDelta !== 0) return areaDelta;
  return compareStrings(a.entry.recordId, b.entry.recordId);
}

/** Build the search index (frozen copy, machine-stable input order kept). */
export function buildSearchIndex(entries: readonly ShellRecordSummary[]): readonly ShellRecordSummary[] {
  return frozenArray(entries);
}

/** Search the index. Deterministic; blank queries refuse. */
export function searchIndex(
  index: readonly ShellRecordSummary[],
  query: string,
): ShellSearchOutcome {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    // Distinguish truly empty from whitespace-only? Both refuse, but with
    // distinct reasons so operators can tell input-shape from no-input.
    if (query.length === 0) return { ok: false, reason: "empty_query" };
    return { ok: false, reason: "blank_query" };
  }
  const results: ShellSearchResult[] = [];
  for (const entry of index) {
    const match = bestMatch(entry, trimmed);
    if (match !== null) {
      results.push({ entry, match, rank: MATCH_RANK[match] });
    }
  }
  results.sort(compareSearchResults);
  return { ok: true, results: frozenArray(results) };
}
