/**
 * W145 deploy convergence — the tenant's durable twin list.
 *
 *   GET /api/device/twins — an authenticated session reads its OWN
 *   workspace's device twins (the client roster hydration source on the
 *   deployed tier; the demo workspace is refused — its roster is the
 *   composed fixture).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleListDeviceTwins } from "../../../../src/server/server-declared-import";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleListDeviceTwins(request);
}
