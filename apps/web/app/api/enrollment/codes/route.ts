/**
 * W140 — the server-side scoped-code issuance route.
 *
 *   POST /api/enrollment/codes — an authenticated operator session with
 *   an operator-and-above role issues a high-entropy enrollment code
 *   (W130 shape: base32, ~100-bit body; verifier-only persistence; the
 *   code is returned exactly once for display).
 *
 *   W147 — DELETE /api/enrollment/codes — an authenticated operator
 *   revokes a pending enrollment code (the "Disable this code…" path;
 *   sets status to `revoked`, audited).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleIssueEnrollmentCode, handleRevokeEnrollmentCode } from "../../../../src/server/server-enrollment";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleIssueEnrollmentCode(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRevokeEnrollmentCode(request);
}
