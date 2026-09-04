import { readLogs } from "./file-store";
import type { LogsPayload } from "./types";

export async function getLogsPayload(): Promise<LogsPayload> {
  return { entries: await readLogs(500) };
}
