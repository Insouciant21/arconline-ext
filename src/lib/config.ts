import path from "node:path";
import { AppError } from "./errors";

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const MOBILE_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");

export const config = {
  arcaeaApiBase: process.env.ARCAEA_API_BASE?.trim() || "https://webapi.lowiro.com",
  arcaeaWebBase: process.env.ARCAEA_WEB_BASE?.trim() || "https://arcaea.lowiro.com",
  arcaeaAssetBase: process.env.ARCAEA_ASSET_BASE?.trim() || "https://webassets.lowiro.com",
  arcaeaUserAgent: process.env.ARCAEA_USER_AGENT?.trim() || MOBILE_CHROME_UA,
  username: firstEnv("ARCAEA_USERNAME", "USERNAME"),
  password: firstEnv("ARCAEA_PASSWORD", "PASSWD"),
  dataDir,
  r2AccountId: process.env.R2_ACCOUNT_ID?.trim(),
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(),
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
  r2BucketName: firstEnv("R2_BUCKET_NAME", "R2_BUCKET"),
  r2PublicUrl: process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, ""),
  r2Endpoint: process.env.R2_ENDPOINT?.trim(),
  timezone: process.env.SCHEDULE_TIMEZONE?.trim() || "Asia/Shanghai",
  cronExpression: "59 59 23 * * *",
};

export function getArcaeaCredentials() {
  if (!config.username || !config.password) {
    throw new AppError(
      "缺少 Arcaea 登录配置，请在服务端 .env 设置 USERNAME 与 PASSWD。",
      503,
      "ARCAEA_CREDENTIALS_MISSING",
    );
  }
  return { username: config.username, password: config.password };
}

export function isR2Configured() {
  return Boolean(
    config.r2AccountId &&
      config.r2AccessKeyId &&
      config.r2SecretAccessKey &&
      config.r2BucketName,
  );
}

export function requireR2() {
  if (!isR2Configured()) {
    throw new AppError(
      "缺少 Cloudflare R2 配置，请设置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY 与 R2_BUCKET_NAME。",
      503,
      "R2_CONFIG_MISSING",
    );
  }
}
