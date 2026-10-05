import { createSessionService } from "@fleetos/identity";
import { createDurableSessionRepository } from "@fleetos/identity";
import { createDriverFromEnv } from "./src/server/durable-driver";
import { createRequestScopedRecordStore } from "@fleetos/identity";

const driver = createDriverFromEnv();
console.log("driver:", driver !== undefined);
const store = await createRequestScopedRecordStore({ driver, tenants: ["tnt_w144w8adadeac58ff"] });
const s = store.store;
const ctx = (store as unknown as { context: { tenantId: string } }).context;
console.log("store keys:", Object.keys(store));
