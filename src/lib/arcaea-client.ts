import { AppError } from "./errors";
import { getConfig, getArcaeaCredentials } from "./config";
import type { Env } from "./environment";
import type { Best50Score, LocalizedTitle, Score, SongScore, SongScoreQuery, SongScoresPayload, StoredUser } from "./types";
import { songScoreSearchParams, SONG_SCORE_PAGE_SIZE } from "./song-query";
import { ArcaeaSessionCache, sessionFromHeaders, type ArcaeaSession } from "./arcaea-session";
import { measure, type Profiler } from "./profiling";

interface ApiEnvelope {
  success?: boolean;
  error_code?: number;
  isLoggedIn?: boolean;
  value?: unknown;
  message?: string;
}

type ImageKind = "potential" | "chart" | "character" | "banner";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ARCAEA_REQUEST_TIMEOUT_MS = 30_000;

export class ArcaeaClient {
  private refreshing?: Promise<void>;

  private constructor(private session: ArcaeaSession, private readonly config: ReturnType<typeof getConfig>,
    private readonly sessionCache: ArcaeaSessionCache, private readonly authenticate: () => Promise<ArcaeaSession>,
    private readonly profiling?: Profiler) {}

  static async login(env: Env, profiling?: Profiler) {
    const config = getConfig(env);
    const credentials = getArcaeaCredentials(env);
    const cache = await ArcaeaSessionCache.create(env, config, credentials);
    const authenticate = () => measure(profiling, "lowiro.login", () => ArcaeaClient.authenticate(config, credentials));
    return new ArcaeaClient(await measure(profiling, "lowiro.session", () => cache.get(authenticate)), config, cache, authenticate, profiling);
  }

  private static async authenticate(config: ReturnType<typeof getConfig>, credentials: ReturnType<typeof getArcaeaCredentials>) {
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
      redirect: "manual",
    });

    const payload = await parseJson<ApiEnvelope>(response);
    if (!response.ok || payload.isLoggedIn !== true) {
      const code = Number.isSafeInteger(payload.error_code) ? `，错误码 ${payload.error_code}` : "";
      throw new AppError(`Arcaea 登录失败（HTTP ${response.status}${code}），请检查账号配置或账号状态。`, 502, "ARCAEA_LOGIN_FAILED");
    }

    const session = sessionFromHeaders(response.headers);
    if (!session) {
      throw new AppError("Arcaea 登录成功但没有返回会话 Cookie。", 502, "ARCAEA_SESSION_MISSING");
    }

    return session;
  }

  async getUser(): Promise<StoredUser> {
    const payload = await measure(this.profiling, "lowiro.user", () => this.request<ApiEnvelope>("/webapi/user/me"));
    const raw = asRecord(payload.value);
    const characterId = asOptionalInteger(raw.character);
    const activeCharacter = Array.isArray(raw.character_stats)
      ? raw.character_stats
          .map(asRecord)
          .find((character) => asOptionalInteger(character.character_id) === characterId)
      : undefined;
    const characterIcon = asOptionalString(activeCharacter?.icon);
    const joinDate = asOptionalInteger(raw.join_date);
    const banners = (Array.isArray(raw.banners) ? raw.banners : []).map(asRecord)
      .filter((banner): banner is { id: string; resource: string } =>
        typeof banner.id === "string" && /^[a-z0-9_-]{1,80}$/.test(banner.id) &&
        typeof banner.resource === "string" && /^[a-f0-9]{32}$/i.test(banner.resource));
    // A hidden plate stays hidden. Without a custom choice, the game uses the
    // highest unlocked course banner rather than the newest subscription gift.
    const banner = raw.custom_banner === "hidden" ? undefined :
      banners.find(banner => banner.id === raw.custom_banner) ??
      banners.filter(banner => /^course_banner_\d+$/.test(banner.id))
        .sort((a, b) => Number(b.id.slice(14)) - Number(a.id.slice(14)))[0];
    return {
      rating: normalizePotential(raw.rating),
      name: asOptionalString(raw.name || raw.display_name || raw.user_name),
      userCode: asOptionalString(raw.user_code || raw.usercode),
      country: asOptionalString(raw.country),
      ...(joinDate !== undefined ? { joinDate } : {}),
      ...(characterId !== undefined ? { characterId } : {}),
      ...(characterIcon ? { characterIcon } : {}),
      ...(typeof activeCharacter?.is_uncapped === "boolean" ? { characterUncapped: activeCharacter.is_uncapped } : {}),
      ...(typeof activeCharacter?.is_uncapped_override === "boolean" ? { characterUncappedOverride: activeCharacter.is_uncapped_override } : {}),
      ...(banner ? { bannerId: banner.id, bannerResource: banner.resource } : {}),
    };
  }

  async getBest50(): Promise<Best50Score[]> {
    const payload = await measure(this.profiling, "lowiro.b50", () => this.request<ApiEnvelope>("/webapi/score/rating/me"));
    const raw = asRecord(payload.value);
    const scores = Array.isArray(raw.best_rated_scores) ? raw.best_rated_scores : [];
    if (scores.length === 0) {
      throw new AppError("Arcaea 返回的 B50 为空，请稍后重试。", 502, "ARCAEA_B50_EMPTY");
    }
    return scores.map(normalizeScore).sort((a, b) => b.rating - a.rating).slice(0, 50);
  }

  async getSongScores(query: SongScoreQuery): Promise<SongScoresPayload> {
    const payload = await this.request<ApiEnvelope>(`/webapi/score/song/me/all?${songScoreSearchParams(query)}`);
    const raw = asRecord(payload.value);
    if (payload.success !== true) {
      throw new AppError("单曲查询失败，请确认 Arcaea Online 订阅有效后重试。", 502, "ARCAEA_SONG_QUERY_FAILED");
    }
    if (!Array.isArray(raw.scores) || raw.scores.length > SONG_SCORE_PAGE_SIZE ||
        typeof raw.count !== "number" || !Number.isSafeInteger(raw.count) || raw.count < raw.scores.length) {
      throw new AppError("官网返回的单曲成绩格式异常，请稍后重试。", 502, "ARCAEA_SONG_SCORES_INVALID");
    }
    return { scores: raw.scores.map(normalizeSongScore), count: raw.count };
  }

  async getPotentialHistory() {
    const payload = await measure(this.profiling, "lowiro.history", () => this.request<ApiEnvelope>("/webapi/score/rating_progression/me?duration=5y"));
    if (!Array.isArray(payload.value)) {
      throw new AppError("官网历史潜力值响应异常。", 502, "ARCAEA_HISTORY_INVALID");
    }
    return payload.value.map((value) => {
      const raw = asRecord(value);
      if (typeof raw.time_played !== "number" || !Number.isFinite(raw.time_played) ||
          !Number.isFinite(new Date(raw.time_played).getTime()) || typeof raw.user_rating !== "number" ||
          !Number.isFinite(raw.user_rating) || raw.user_rating < 0) {
        throw new AppError("官网历史潜力值数据无效。", 502, "ARCAEA_HISTORY_INVALID");
      }
      return { timePlayed: raw.time_played, potential: raw.user_rating / 1000 };
    });
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
    return this.fetchImage(`${this.config.arcaeaAssetBase}/${bg}.jpg?v=323`, "chart");
  }

  async getCharacterIconImage(icon: string) {
    if (!/^[a-f0-9]{32}$/i.test(icon)) {
      throw new AppError("角色头像标识格式不合法。", 502, "ARCAEA_CHARACTER_ICON_INVALID");
    }
    return measure(this.profiling, "lowiro.avatar", () => this.fetchImage(`${this.config.arcaeaAssetBase}/chr/${icon}.png`, "character"));
  }

  async getBannerImage(resource: string) {
    if (!/^[a-f0-9]{32}$/i.test(resource)) {
      throw new AppError("名片标识格式不合法。", 502, "ARCAEA_BANNER_INVALID");
    }
    return measure(this.profiling, "lowiro.banner", () => this.fetchImage(`${this.config.arcaeaAssetBase}/${resource}.png`, "banner"));
  }

  async fetchB50Snapshot() {
    const [user, best50] = await Promise.all([this.getUser(), this.getBest50()]);
    return { user, best50 };
  }

  private async request<T extends ApiEnvelope>(path: string, retrySession = true): Promise<T> {
    if (this.refreshing) await this.refreshing;
    const session = this.session;
    const response = await fetch(`${this.config.arcaeaApiBase}${path}`, {
      headers: {
        accept: "application/json",
        cookie: session.cookies,
        origin: this.config.arcaeaWebBase,
        referer: `${this.config.arcaeaWebBase}/zh/profile/potential`,
        "user-agent": this.config.arcaeaUserAgent,
      },
      signal: AbortSignal.timeout(ARCAEA_REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
    // Lowiro returns error 203 (HTTP 400) without a session. A bare 403 may be
    // a subscription/WAF failure and must not cause repeated password logins.
    const payload = response.status === 401 ? undefined : await parseJson<T>(response);
    if (response.status === 401 || payload?.isLoggedIn === false ||
        (payload?.success === false && payload.error_code === 203)) {
      if (response.status === 401) await response.body?.cancel();
      if (!retrySession) {
        await this.sessionCache.invalidate(session);
        throw new AppError("Arcaea 会话已失效，请稍后重试。", 502, "ARCAEA_SESSION_EXPIRED");
      }
      await this.refreshSession(session);
      return this.request<T>(path, false);
    }
    if (!response.ok) {
      throw new AppError(`Arcaea 接口请求失败（${response.status}）。`, 502, "ARCAEA_API_FAILED");
    }
    return payload!;
  }

  private async refreshSession(rejected: ArcaeaSession) {
    if (this.session !== rejected) return;
    this.refreshing ??= this.sessionCache.get(this.authenticate, rejected)
      .then(session => { this.session = session; this.refreshing = undefined; });
    await this.refreshing;
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
        referer: `${this.config.arcaeaWebBase}/zh/profile/potential`,
        "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
        "user-agent": this.config.arcaeaUserAgent,
      },
      signal: AbortSignal.timeout(ARCAEA_REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
    if (!response.ok) {
      throw new AppError(
        `Arcaea 图片请求失败（${response.status}）。`,
        502,
        kind === "potential"
          ? "ARCAEA_PTT_IMAGE_FAILED"
          : kind === "chart"
            ? "ARCAEA_CHART_IMAGE_FAILED"
            : kind === "banner" ? "ARCAEA_BANNER_IMAGE_FAILED" : "ARCAEA_CHARACTER_IMAGE_FAILED",
      );
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new AppError("图片超过允许的大小。", 502, "ARCAEA_IMAGE_TOO_LARGE");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("图片响应为空。", 502, "ARCAEA_IMAGE_EMPTY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new AppError("图片超过允许的大小。", 502, "ARCAEA_IMAGE_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = bytes.buffer;
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
  return { ...normalizeScoreFields(raw), rating: asNumber(raw.rating) };
}

function normalizeSongScore(rawValue: unknown): SongScore {
  const raw = asRecord(rawValue);
  const integers = ["difficulty", "score", "perfect_count", "shiny_perfect_count", "near_count", "miss_count", "clear_type", "best_clear_type", "time_played", "yearly_play_count"];
  if (typeof raw.song_id !== "string" || !raw.song_id ||
      integers.some(key => typeof raw[key] !== "number" || !Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0) ||
      (raw.difficulty as number) > 4 || (raw.clear_type as number) > 5 || (raw.best_clear_type as number) > 5 ||
      (raw.shiny_perfect_count as number) > (raw.perfect_count as number)) {
    throw new AppError("官网返回的单曲成绩数据无效，请稍后重试。", 502, "ARCAEA_SONG_SCORES_INVALID");
  }
  return {
    ...normalizeScoreFields(raw),
    shinyPerfectCount: raw.shiny_perfect_count as number,
    bestClearType: raw.best_clear_type as number,
    yearlyPlayCount: raw.yearly_play_count as number,
  };
}

function normalizeScoreFields(raw: Record<string, unknown>): Score {
  return {
    songId: asString(raw.song_id),
    difficulty: asNumber(raw.difficulty),
    ...(asOptionalInteger(raw.difficulty_alias) !== undefined ? { difficultyAlias: asOptionalInteger(raw.difficulty_alias) } : {}),
    modifier: asNumber(raw.modifier),
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
