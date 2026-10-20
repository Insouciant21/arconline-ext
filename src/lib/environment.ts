export interface JobMessage { jobId: string; step: number; }

export interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  JOBS: Queue<JobMessage>;
  ASSETS?: Fetcher;
  LOGIN_RATE_LIMITER?: RateLimit;
  ADMIN_TOKEN?: string;
  USERNAME?: string;
  PASSWD?: string;
  ARCAEA_USERNAME?: string;
  ARCAEA_PASSWORD?: string;
  ARCAEA_API_BASE?: string;
  ARCAEA_WEB_BASE?: string;
  ARCAEA_ASSET_BASE?: string;
  ARCAEA_USER_AGENT?: string;
  APP_ORIGIN?: string;
  R2_PUBLIC_URL?: string;
  SCHEDULE_TIMEZONE?: string;
  DAILY_SYNC_ENABLED?: string;
  MUTATIONS_ENABLED?: string;
}
