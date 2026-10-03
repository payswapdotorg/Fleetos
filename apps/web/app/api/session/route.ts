/**
 * W140 — the server-issued session route (the deployed tier's session
 * lifecycle over the server control plane).
 *
 *   POST   /api/session  — sign in (identity password seam; httpOnly cookie)
 *   GET    /api/session  — resolve (fail-closed on every refusal path)
 *   DELETE /api/session  — revoke (audited; cookie cleared)
 *
 * The route is a THIN wrapper: every domain decision lives in
 * apps/web/src/server (server-only modules). Development tier behavior
 * is unchanged (the localStorage session seam stays the dev path).
 */
import {
  handleServerSignIn,
  handleServerResolveSession,
  handleServerRevokeSession,
} from "../../../src/server/server-sessions";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleServerSignIn(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleServerResolveSession(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleServerRevokeSession(request);
}
