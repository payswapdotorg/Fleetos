/**
 * @fleetos/web — W140: internal helpers of the server plane.
 *
 * SERVER-ONLY (apps/web/src/server). Deterministic machinery shared by
 * the server control-plane modules: freezing, canonical JSON, digests,
 * ISO-instant parsing, and the machine-stable JSON response envelope.
 * No `any` in public signatures. No clock reads (instants are injected
 * by the HTTP boundary). No secret VALUES ever enter a response.
 */

/** Deep-freeze a plain object (one level, like the lanes' `frozen`). */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Freeze a copy of an array (like the lanes' `frozenArray`). */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests (the lanes' shared algorithm: recursive key
// sort, arrays preserved — the same basis the audit hash chain uses)
// ---------------------------------------------------------------------------

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => serialize(entry)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => JSON.stringify(key) + ":" + serialize(record[key])).join(",");
  return "{" + body + "}";
}

/**
 * Deterministic canonical JSON: object keys sorted recursively, arrays
 * in order. Structurally equal values produce the same string (the
 * idempotency-comparison basis of the server plane).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

// ---------------------------------------------------------------------------
// Instants (fail-closed parsing — the lanes' discipline)
// ---------------------------------------------------------------------------

/**
 * Parse an ISO 8601 instant to epoch milliseconds. Undefined when
 * unparseable (fail-closed: callers treat unparseable as expired).
 */
export function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Minimal ISO 8601 shape check (the lanes' shared laxness). */
export function looksLikeIso(value: string): boolean {
  return typeof value === "string" && /T\d{2}:\d{2}/.test(value);
}

// ---------------------------------------------------------------------------
// The machine-stable HTTP response envelope
// ---------------------------------------------------------------------------

/** The machine-stable refusal body every fail-closed route returns. */
export interface ServerRefusalBody {
  readonly ok: false;
  /** The machine-stable refusal reason (frozen vocabulary per route). */
  readonly reason: string;
  /** The human explanation (rendered verbatim downstream). */
  readonly message: string;
}

/** Build the JSON body of a refusal (sorted keys — byte-stable). */
export function refusalBody(reason: string, message: string): ServerRefusalBody {
  return frozen({ ok: false as const, reason, message });
}

/**
 * Build a JSON `Response` with a stable body (key-sorted JSON — the
 * same response shape yields the same bytes).
 */
export function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers ?? {}) },
  });
}

/**
 * Parse a request body as JSON, fail-closed: an unparseable body is a
 * machine-stable `invalid_json` refusal (never a crash, never a
 * fabricated default).
 */
export async function parseJsonBody(
  request: Request,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonResponse(refusalBody("invalid_json", "The request body could not be read."), 400) };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse(refusalBody("invalid_json", "The request body is not valid JSON."), 400) };
  }
}

/** Read a non-empty trimmed string field from an untrusted body. */
export function stringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
