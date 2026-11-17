import { CHART_CONSTANTS_VERSION } from "./chart-constants";
import { getConfig } from "./config";
import type { Env } from "./environment";
import { AppError } from "./errors";
import { Store } from "./store";
import type { GameVersionStatus } from "./types";

const CACHE_KIND = "meta";
const CACHE_KEY = "arcaea-version";
export const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const VERSION_FETCH_TIMEOUT_MS = 10_000;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[a-z]+)?$/i;

interface CachedVersionRecord {
  latestVersion: string;
  checkedAt: string;
}

interface ApkVersionEnvelope {
  success?: boolean;
  value?: {
    version?: unknown;
  };
}

export function parseVersionTuple(version: string): [number, number, number] | null {
  const match = version.trim().match(VERSION_PATTERN);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isChartConstantsUpToDate(latestVersion: string, constantsVersion = CHART_CONSTANTS_VERSION): boolean | null {
  const latest = parseVersionTuple(latestVersion);
  const current = parseVersionTuple(constantsVersion);
  if (!latest || !current) return null;
  for (let index = 0; index < 3; index++) {
    if (latest[index] !== current[index]) return latest[index] < current[index];
  }
  return true;
}

function buildStatus(record?: CachedVersionRecord | null, error?: string): GameVersionStatus {
  const latestVersion = record?.latestVersion ?? null;
  return {
    constantsVersion: CHART_CONSTANTS_VERSION,
    latestVersion,
    upToDate: latestVersion ? isChartConstantsUpToDate(latestVersion, CHART_CONSTANTS_VERSION) : null,
    checkedAt: record?.checkedAt ?? null,
    source: "lowiro-apk",
    ...(error ? { error } : {}),
  };
}

function isFresh(checkedAt: string | undefined, now = Date.now()) {
  if (!checkedAt) return false;
  const timestamp = Date.parse(checkedAt);
  return Number.isFinite(timestamp) && now - timestamp < VERSION_CACHE_TTL_MS;
}

export async function readCachedGameVersion(env: Env): Promise<GameVersionStatus> {
  try {
    const cached = await new Store(env).cache<CachedVersionRecord>(CACHE_KIND, [CACHE_KEY]);
    return buildStatus(cached[CACHE_KEY]);
  } catch {
    return buildStatus();
  }
}

export async function checkGameVersion(env: Env, options: { refresh?: boolean } = {}): Promise<GameVersionStatus> {
  const store = new Store(env);
  const cached = (await store.cache<CachedVersionRecord>(CACHE_KIND, [CACHE_KEY]).catch(() => ({} as Record<string, CachedVersionRecord>)))[CACHE_KEY];
  if (!options.refresh && cached && isFresh(cached.checkedAt)) {
    return buildStatus(cached);
  }

  const config = getConfig(env);
  try {
    const response = await fetch(`${config.arcaeaApiBase}/webapi/serve/static/bin/arcaea/apk`, {
      headers: {
        accept: "application/json",
        "user-agent": config.arcaeaUserAgent,
      },
      signal: AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (!response.ok) {
      throw new AppError(`官网版本检测失败（${response.status}）。`, 502, "ARCAEA_VERSION_CHECK_FAILED");
    }
    const payload = await response.json() as ApkVersionEnvelope;
    const rawVersion = typeof payload.value?.version === "string" ? payload.value.version.trim() : "";
    if (payload.success !== true || !parseVersionTuple(rawVersion)) {
      throw new AppError("官网返回的版本号格式无效。", 502, "ARCAEA_VERSION_INVALID");
    }
    const record: CachedVersionRecord = {
      latestVersion: rawVersion,
      checkedAt: new Date().toISOString(),
    };
    await store.putCache(CACHE_KIND, CACHE_KEY, record);
    return buildStatus(record);
  } catch (error) {
    if (options.refresh) {
      if (error instanceof AppError) throw error;
      throw new AppError("暂时无法连接官网检测版本，请稍后重试。", 502, "ARCAEA_VERSION_CHECK_FAILED");
    }
    return buildStatus(cached, cached ? "版本刷新失败，当前显示缓存结果。" : "暂时无法连接官网检测版本。");
  }
}
