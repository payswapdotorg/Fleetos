/**
 * W140 — the server-side enrollment verification (redemption) route.
 *
 *   POST /api/enrollment/redeem — the installer/agent redeems a
 *   one-time enrollment code (tenant-scoped — the W130 law: cross-
 *   tenant codes are machine-stable code_not_found; the demo tenant is
 *   never a scope). Creates the REAL device record + membership and
 *   issues the device-scoped trust record for the agent's first
 *   check-in — the Install Center's "unbootstrapped — waiting" state
 *   becomes real.
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleRedeemEnrollmentCode } from "../../../../src/server/server-enrollment";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRedeemEnrollmentCode(request);
}
