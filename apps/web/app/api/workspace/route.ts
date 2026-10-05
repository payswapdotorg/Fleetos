/**
 * W144 deploy convergence — the server-side workspace-creation route.
 *
 *   POST /api/workspace — the founder creates a workspace through the
 *   REAL frozen identity boundary (durable repositories; the founder's
 *   password credential is registered verifier-only) and lands signed-in
 *   (httpOnly cookie; the response carries the session projection).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleCreateWorkspace } from "../../../src/server/server-workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleCreateWorkspace(request);
}
