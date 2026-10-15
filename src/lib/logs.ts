import type { Env } from "./environment";
import { Store } from "./store";
export async function getLogsPayload(env: Env) { return { entries: await new Store(env).logs() }; }
