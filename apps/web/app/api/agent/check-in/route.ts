/**
 * W140 — the real agent check-in endpoint.
 *
 *   POST /api/agent/check-in — the frozen check-in command wire shape
 *   (CommandEnvelope<CheckInCommandPayload>). Idempotent (replay
 *   returns the stored ack), correlation + causation ids carried on
 *   the ack event, every accepted check-in / duplicate / refusal
 *   audited through the durable hash-chained audit seam. The agent is
 *   authenticated by the device-scoped trust record issued at
 *   enrollment (unknown/expired/revoked/mismatched all fail closed).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleAgentCheckIn } from "../../../../src/server/server-checkin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleAgentCheckIn(request);
}
