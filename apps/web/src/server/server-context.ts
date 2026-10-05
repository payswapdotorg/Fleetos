/**
 * @fleetos/web — W140: the server-plane request context.
 *
 * SERVER-ONLY (apps/web/src/server). The ONE composition point every
 * API route handler opens: resolve the driver (env seam), ensure the
 * physical schema (idempotent, cached per driver), open the
 * request-scoped record store for the acting tenants, and build the
 * audit plane. The handler runs its sync service logic, then awaits
 * the ordered flush BEFORE responding.
 *
 * The handler deps are INJECTABLE (driver, now, correlation id,
 * entropy) — the deterministic test suite pins every one of them; the
 * production defaults read the clock/entropy exactly once, HERE at the
 * HTTP boundary (the domain services never read a clock).
 *
 * Fail-closed discipline: no DATABASE_URL → the machine-stable
 * `server_store_unavailable` refusal (the server tier is NEVER
 * silently replaced by an in-memory fabrication); a driver/flush error
 * → the same refusal shape (never a partial success).
 *
 * No `any` in public signatures. Strict TS.
 */

import type { CorrelationId } from "@fleetos/contracts";
import { asCorrelationId } from "@fleetos/contracts";
import type { DurableDriver } from "./durable-driver";
import { createDriverFromEnv } from "./durable-driver";
import type { RequestScopedRecordStore } from "./neon-record-store";
import { createRequestScopedRecordStore } from "./neon-record-store";
import { renderServerDurableSchemaSql } from "./server-tables";
import type { ServerAuditPlane } from "./server-audit";
import { buildServerAuditPlane } from "./server-audit";
import type { ServerEntropy } from "./server-entropy";
import { createServerEntropy } from "./server-entropy";
import { jsonResponse, refusalBody, frozen } from "./server-internal";

/** The injectable per-request deps (all optional; production defaults below). */
export interface ServerHandlerDeps {
  /** The durable driver (default: from DATABASE_URL — refuse when absent). */
  readonly driver?: DurableDriver;
  /** The request instant (default: the wall clock at the boundary). */
  readonly now?: string;
  /** The request correlation id (default: fresh from the entropy toolkit). */
  readonly correlationId?: CorrelationId;
  /** The entropy toolkit (default: Web Crypto, fail-closed). */
  readonly entropy?: ServerEntropy;
}

/** One open server-plane request: the store, the audit plane, the deps. */
export interface ServerRequestContext {
  readonly store: RequestScopedRecordStore;
  readonly audit: ServerAuditPlane;
  readonly deps: ResolvedServerDeps;
  /** Execute the ordered write log (the handler MUST await before responding). */
  flush(): Promise<void>;
}

/** The resolved deps (every optional member made concrete). */
export interface ResolvedServerDeps {
  readonly driver: DurableDriver;
  readonly now: string;
  readonly correlationId: CorrelationId;
  readonly entropy: ServerEntropy;
}

/** The schema-ensure cache: one idempotent application per driver. */
const schemaCache = new WeakMap<DurableDriver, Promise<void>>();

/** The rendered schema statements (module-level: derived once, pure). */
const SCHEMA_STATEMENTS: readonly string[] = renderServerDurableSchemaSql()
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)
  .map((statement) => `${statement};`);

/** Apply the idempotent physical schema once per driver (cached). */
export function ensureServerSchema(driver: DurableDriver): Promise<void> {
  const cached = schemaCache.get(driver);
  if (cached !== undefined) return cached;
  const applied = driver.applySchema(SCHEMA_STATEMENTS);
  schemaCache.set(driver, applied);
  return applied;
}

/** The machine-stable refusal when the durable tier is unavailable. */
export function storeUnavailableResponse(): Response {
  return jsonResponse(
    refusalBody(
      "server_store_unavailable",
      "The server control plane's durable store is unavailable. The request was refused; nothing was recorded.",
    ),
    503,
  );
}

/** The machine-stable refusal when a store write fails (fail-closed). */
export function storeWriteFailedResponse(): Response {
  return jsonResponse(
    refusalBody(
      "server_store_write_failed",
      "A durable write was refused. The request failed closed; no partial state was kept.",
    ),
    503,
  );
}

/** The machine-stable refusal when server entropy is unavailable. */
export function entropyUnavailableResponse(): Response {
  return jsonResponse(
    refusalBody(
      "server_entropy_unavailable",
      "The server could not mint a high-entropy credential. The request was refused; nothing was recorded.",
    ),
    503,
  );
}

/**
 * Open a server-plane request for the acting tenants.
 *
 * @param tenants the tenants whose partitions the request works on
 * @param deps the injectable handler deps
 * @returns the open context, or a fail-closed Response the handler returns as-is
 */
export async function openServerRequest(
  tenants: readonly string[],
  deps: ServerHandlerDeps = {},
): Promise<{ readonly ok: true; readonly context: ServerRequestContext } | { readonly ok: false; readonly response: Response }> {
  const driver = deps.driver ?? createDriverFromEnv();
  if (driver === undefined) {
    return { ok: false, response: storeUnavailableResponse() };
  }
  let now = deps.now;
  if (now === undefined) {
    now = new Date().toISOString();
  }
  let entropy = deps.entropy;
  let correlationId = deps.correlationId;
  if (entropy === undefined || correlationId === undefined) {
    try {
      const resolvedEntropy = entropy ?? createServerEntropy();
      if (correlationId === undefined) {
        correlationId = asCorrelationId(resolvedEntropy.correlationId());
      }
      entropy = resolvedEntropy;
    } catch {
      return { ok: false, response: entropyUnavailableResponse() };
    }
  }
  const resolved: ResolvedServerDeps = frozen({
    driver,
    now,
    correlationId,
    entropy,
  });
  try {
    await ensureServerSchema(driver);
    const store = await createRequestScopedRecordStore({ driver, tenants });
    const audit = buildServerAuditPlane(store.store);
    return {
      ok: true,
      context: frozen({
        store,
        audit,
        deps: resolved,
        flush: store.flush,
      }),
    };
  } catch {
    return { ok: false, response: storeUnavailableResponse() };
  }
}

/**
 * Run the ordered flush and translate a failure into the fail-closed
 * store refusal (handlers call this before responding on success).
 */
export async function flushOrRefuse(
  context: ServerRequestContext,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly response: Response }> {
  try {
    await context.flush();
    return { ok: true };
  } catch {
    return { ok: false, response: storeWriteFailedResponse() };
  }
}
