import { AppError } from "./errors";
import { config, getArcaeaCredentials } from "./config";
import type { Best50Score, LocalizedTitle, StoredUser } from "./types";

interface ArcaeaSession {
  cookies: string;
}

interface ApiEnvelope {
  isLoggedIn?: boolean;
  value?: unknown;
  message?: string;
}

type ImageKind = "potential" | "chart" | "character";

export interface RemoteSnapshotData {
  user: StoredUser;
  best50: Best50Score[];
  potentialImage: {
    body: Buffer;
    contentType: string;
  };
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ARCAEA_REQUEST_TIMEOUT_MS = 30_000;

export class ArcaeaClient {
  private constructor(private readonly session: ArcaeaSession) {}

  static async login() {
    const credentials = getArcaeaCredentials();
    const response = await fetch(`${config.arcaeaApiBase}/auth/login`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: config.arcaeaWebBase,
        referer: `${config.arcaeaWebBase}/zh/profile/potential`,
        "user-agent": config.arcaeaUserAgent,
      },
      body: JSON.stringify({ email: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(ARCAEA_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    const payload = await parseJson<ApiEnvelope>(response);
    if (!response.ok || payload.isLoggedIn !== true) {
      throw new AppError("Arcaea 登录失败，请检查账号配置或账号状态。", 502, "ARCAEA_LOGIN_FAILED");
    }

    const cookies = getSetCookieHeader(response.headers);
    if (!cookies) {
      throw new AppError("Arcaea 登录成功但没有返回会话 Cookie。", 502, "ARCAEA_SESSION_MISSING");
    }

    const client = new ArcaeaClient({ cookies });
    await client.getUser();
    return client;
  }

  async getUser(): Promise<StoredUser> {
    const payload = await this.request<ApiEnvelope>("/webapi/user/me");
    const raw = asRecord(payload.value);
    const characterId = asOptionalInteger(raw.character);
    const activeCharacter = Array.isArray(raw.character_stats)
      ? raw.character_stats
          .map(asRecord)
          .find((character) => asOptionalInteger(character.character_id) === characterId)
      : undefined;
    const characterIcon = asOptionalString(activeCharacter?.icon);
    const joinDate = asOptionalInteger(raw.join_date);
    return {
      rating: normalizePotential(raw.rating),
      name: asOptionalString(raw.name || raw.display_name || raw.user_name),
      userCode: asOptionalString(raw.user_code || raw.usercode),
      country: asOptionalString(raw.country),
      ...(joinDate !== undefined ? { joinDate } : {}),
      ...(characterId !== undefined ? { characterId } : {}),
      ...(characterIcon ? { characterIcon } : {}),
    };
  }

  async getBest50(): Promise<Best50Score[]> {
    const payload = await this.request<ApiEnvelope>("/webapi/score/rating/me");
    const raw = asRecord(payload.value);
    const scores = Array.isArray(raw.best_rated_scores) ? raw.best_rated_scores : [];
    if (scores.length === 0) {
      throw new AppError("Arcaea 返回的 B50 为空，请稍后重试。", 502, "ARCAEA_B50_EMPTY");
    }
    return scores.map(normalizeScore).sort((a, b) => b.rating - a.rating).slice(0, 50);
  }

  async getOnlineImage() {
    const payload = await this.request<ApiEnvelope>("/webapi/user/me/online_image");
    const raw = asRecord(payload.value);
    const imageUrl = asOptionalString(raw.url);
    if (!imageUrl) {
      throw new AppError("Arcaea 没有返回潜力值图片地址。", 502, "ARCAEA_IMAGE_URL_MISSING");
    }
    return this.fetchImage(imageUrl, "potential");
  }

  async getChartImage(bg: string) {
    if (!/^[a-f0-9]{32}$/i.test(bg)) {
      throw new AppError("曲绘标识格式不合法。", 502, "ARCAEA_BG_INVALID");
    }
    return this.fetchImage(`${config.arcaeaAssetBase}/${bg}.jpg?v=323`, "chart");
  }

  async getCharacterIconImage(icon: string) {
    if (!/^[a-f0-9]{32}$/i.test(icon)) {
      throw new AppError("角色头像标识格式不合法。", 502, "ARCAEA_CHARACTER_ICON_INVALID");
    }
    return this.fetchImage(`${config.arcaeaAssetBase}/chr/${icon}.png`, "character");
  }

  async fetchB50Snapshot() {
    const [user, best50] = await Promise.all([this.getUser(), this.getBest50()]);
    return { user, best50 };
  }

  async fetchSnapshot(): Promise<RemoteSnapshotData> {
    const [base, potentialImage] = await Promise.all([
      this.fetchB50Snapshot(),
      this.getOnlineImage(),
    ]);
    return { ...base, potentialImage };
  }

  private async request<T extends ApiEnvelope>(path: string) {
    const response = await fetch(`${config.arcaeaApiBase}${path}`, {
      headers: {
        accept: "application/json",
        cookie: this.session.cookies,
        origin: config.arcaeaWebBase,
        referer: `${config.arcaeaWebBase}/zh/profile/potential`,
        "user-agent": config.arcaeaUserAgent,
      },
      signal: AbortSignal.timeout(ARCAEA_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const payload = await parseJson<T>(response);
    if (!response.ok) {
      throw new AppError(`Arcaea 接口请求失败（${response.status}）。`, 502, "ARCAEA_API_FAILED");
    }
    return payload;
  }

  private async fetchImage(imageUrl: string, kind: ImageKind) {
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      throw new AppError("Arcaea 返回了无效的图片地址。", 502, "ARCAEA_IMAGE_URL_INVALID");
    }
    if (url.protocol !== "https:" || !isAllowedLowiroHost(url.hostname)) {
      throw new AppError("图片地址不属于 Lowiro 资源域名，已拒绝访问。", 502, "ARCAEA_IMAGE_HOST_REJECTED");
    }

    const response = await fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        cookie: this.session.cookies,
        referer: `${config.arcaeaWebBase}/zh/profile/potential`,
        "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
        "user-agent": config.arcaeaUserAgent,
      },
      signal: AbortSignal.timeout(ARCAEA_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new AppError(
        `Arcaea 图片请求失败（${response.status}）。`,
        502,
        kind === "potential"
          ? "ARCAEA_PTT_IMAGE_FAILED"
          : kind === "chart"
            ? "ARCAEA_CHART_IMAGE_FAILED"
            : "ARCAEA_CHARACTER_IMAGE_FAILED",
      );
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new AppError("图片超过允许的大小。", 502, "ARCAEA_IMAGE_TOO_LARGE");
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new AppError("图片超过允许的大小。", 502, "ARCAEA_IMAGE_TOO_LARGE");
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new AppError("Arcaea 图片响应类型异常。", 502, "ARCAEA_IMAGE_CONTENT_TYPE_INVALID");
    }
    return { body, contentType };
  }
}

function normalizeScore(rawValue: unknown): Best50Score {
  const raw = asRecord(rawValue);
  return {
    songId: asString(raw.song_id),
    difficulty: asNumber(raw.difficulty),
    modifier: asNumber(raw.modifier),
    rating: asNumber(raw.rating),
    score: asNumber(raw.score),
    perfectCount: asNumber(raw.perfect_count),
    nearCount: asNumber(raw.near_count),
    missCount: asNumber(raw.miss_count),
    clearType: asNumber(raw.clear_type),
    title: normalizeTitle(raw.title),
    artist: asString(raw.artist),
    timePlayed: asNumber(raw.time_played),
    bg: asOptionalString(raw.bg),
  };
}

function normalizeTitle(value: unknown): LocalizedTitle {
  if (typeof value === "string") return { en: value };
  const raw = asRecord(value);
  const title: LocalizedTitle = {};
  for (const key of ["en", "ja", "zh"]) {
    const value = raw[key];
    if (typeof value === "string") title[key] = value;
  }
  return title;
}

function normalizePotential(value: unknown) {
  const numeric = asNumber(value);
  return numeric > 100 ? numeric / 1000 : numeric;
}

async function parseJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    throw new AppError("Arcaea 返回了无法解析的响应。", 502, "ARCAEA_RESPONSE_INVALID");
  }
}

function getSetCookieHeader(headers: Headers) {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = extendedHeaders.getSetCookie?.() || [];
  if (setCookies.length > 0) return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  const single = headers.get("set-cookie");
  return single
    ?.split(/,\s*(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function isAllowedLowiroHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "lowiro.com" ||
    normalized.endsWith(".lowiro.com") ||
    normalized === "lowiro-cdn.net" ||
    normalized.endsWith(".lowiro-cdn.net")
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : undefined;
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
