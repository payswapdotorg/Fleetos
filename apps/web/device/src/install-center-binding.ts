/**
 * @fleetos/web-device — the Install Center's enrollment-code runtime
 * binding (W101 [TL]; disclosed additive edit, lane A file).
 *
 * The console RUNTIME may not import the adapter lanes directly (the
 * frozen ownership boundary); this module is lane A's public binding
 * site: it wraps the REAL `@fleetos/device-adapters`
 * `createEnrollmentRequest` boundary (tenant-bound, scope-bound,
 * one-time, short-lived, revocable, auditable) behind the web-device
 * public API the Install Center route composes.
 *
 * Pure: every instant is injected; no clock reads; no `any`.
 */

import { createEnrollmentRequest } from "@fleetos/device-adapters";
import type { TenantId } from "@fleetos/contracts";
import type { DeviceOwnershipKind } from "@fleetos/device-adapters";

/** The input of the enrollment-code creation binding. */
export interface CreateInstallEnrollmentCodeInput {
  readonly tenantId: TenantId;
  /** Stable request identifier (non-empty). */
  readonly requestId: string;
  /** The one-time bootstrap code (>= 8 chars; displayed exactly once). */
  readonly code: string;
  readonly ownershipKind: DeviceOwnershipKind;
  /** Time-to-live in milliseconds (> 0). */
  readonly ttlMs: number;
  /** The creation instant (ISO 8601, injected). */
  readonly now: string;
}

/** The machine-stable refusal of the binding. */
export type CreateInstallEnrollmentCodeRefusal =
  | "invalid_input"
  | "boundary_refused";

/** The result: the record + the one-time code (shown exactly once). */
export type CreateInstallEnrollmentCodeResult =
  | {
      readonly ok: true;
      readonly record: import("./install-center").EnrollmentRequestLike;
      readonly code: string;
    }
  | { readonly ok: false; readonly reason: CreateInstallEnrollmentCodeRefusal };

/**
 * Create an enrollment code through the REAL device-adapters boundary.
 * Fail-closed: an invalid input or a boundary refusal NEVER fabricates
 * a record — the refusal is machine-stable with the boundary's own
 * validation reasons.
 */
export function createInstallEnrollmentCode(
  input: CreateInstallEnrollmentCodeInput,
): CreateInstallEnrollmentCodeResult {
  const created = createEnrollmentRequest({
    tenantId: input.tenantId,
    requestId: input.requestId,
    code: input.code,
    ownershipKind: input.ownershipKind,
    ttlMs: input.ttlMs,
    now: input.now,
  });
  if (!created.ok) {
    return { ok: false, reason: "boundary_refused" };
  }
  return { ok: true, record: created.record, code: created.code };
}
