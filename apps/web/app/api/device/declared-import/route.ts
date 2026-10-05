/**
 * W145 deploy convergence — the server-side declared-import route.
 *
 *   POST /api/device/declared-import — an authenticated operator
 *   (operator-and-above) declares a manual device record through the
 *   REAL domain boundary; the record is DURABLE (the tenant's
 *   fleetos_device_twins partition) and audited.
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleDeclareDeviceImport } from "../../../../src/server/server-declared-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleDeclareDeviceImport(request);
}
