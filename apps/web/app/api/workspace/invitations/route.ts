/**
 * W147 — the server-side workspace-invitation issuance route.
 *
 *   POST /api/workspace/invitations — an authenticated operator session
 *   with an operator-and-above role issues a high-entropy workspace-join
 *   code (the W130 shape: base32, ~100-bit body; verifier-only persistence;
 *   the code is returned exactly once for display).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleIssueInvitation } from "../../../../src/server/server-invitations";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleIssueInvitation(request);
}
