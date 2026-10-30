import { AppError } from "./errors";
import type { Env } from "./environment";

const MOBILE_CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const localDateFormatters = new Map<string, Intl.DateTimeFormat>();
export function getConfig(env: Env) {
  return {
    arcaeaApiBase: env.ARCAEA_API_BASE?.trim() || "https://webapi.lowiro.com",
    arcaeaWebBase: env.ARCAEA_WEB_BASE?.trim() || "https://arcaea.lowiro.com",
    arcaeaAssetBase: env.ARCAEA_ASSET_BASE?.trim() || "https://webassets.lowiro.com",
    arcaeaUserAgent: env.ARCAEA_USER_AGENT?.trim() || MOBILE_CHROME_UA,
    timezone: env.SCHEDULE_TIMEZONE?.trim() || "Asia/Shanghai",
    cronExpression: "59 15 * * *",
  };
}
export function getArcaeaCredentials(env: Env) {
  const username = (env.ARCAEA_USERNAME || env.USERNAME)?.trim();
  const password = (env.ARCAEA_PASSWORD || env.PASSWD)?.trim();
  if (!username || !password) throw new AppError("缺少 Arcaea 登录配置。", 503, "ARCAEA_CREDENTIALS_MISSING");
  return { username, password };
}
export function getLocalDate(value: string | number | Date, timezone = "Asia/Shanghai") {
  let formatter = localDateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    localDateFormatters.set(timezone, formatter);
  }
  return formatter.format(new Date(value));
}
