import type { getArcaeaCredentials, getConfig } from "./config";
import type { Env } from "./environment";
import { AppError } from "./errors";

export interface ArcaeaSession {
  id: string;
  cookies: string;
  expiresAt?: number;
}

interface SealedSession {
  version: 1;
  iv: string;
  data: string;
}

const CACHE_KIND = "lowiro-session";
const EXPIRY_MARGIN_MS = 60_000;
const LOGIN_LEASE_MS = 45_000;
const LOGIN_WAIT_MS = 40_000;
const encoder = new TextEncoder();
const context = encoder.encode("arconline-ext/lowiro-session/v1");

// Cookies never enter snapshots, job state or R2 exports. D1 stores only an
// authenticated ciphertext; changing credentials or upstream settings makes
// the old session unreadable without storing a password fingerprint in D1.
export class ArcaeaSessionCache {
  private constructor(private readonly db: D1Database, private readonly key: CryptoKey) {}

  static async create(env: Env, config: ReturnType<typeof getConfig>, credentials: ReturnType<typeof getArcaeaCredentials>) {
    const material = await crypto.subtle.importKey("raw",
      encoder.encode(JSON.stringify([credentials.password, env.ADMIN_TOKEN?.trim() || ""])), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: context,
      info: encoder.encode(JSON.stringify([credentials.username, config.arcaeaApiBase, config.arcaeaWebBase,
        config.arcaeaAssetBase, config.arcaeaUserAgent])),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return new ArcaeaSessionCache(env.DB, key);
  }

  async get(authenticate: () => Promise<ArcaeaSession>, rejected?: ArcaeaSession): Promise<ArcaeaSession> {
    const deadline = Date.now() + LOGIN_WAIT_MS;
    let delay = 100;
    while (true) {
      const cached = await this.read();
      if (cached && cached.session.id !== rejected?.id) return cached.session;

      // A D1 lease coalesces logins across HTTP requests, queue consumers and
      // Worker isolates. Never share an in-flight fetch promise across requests.
      const lease = JSON.stringify({ id: crypto.randomUUID(), until: Date.now() + LOGIN_LEASE_MS });
      const claimed = await this.db.prepare(`INSERT INTO cache(kind,key,body) VALUES(?,'login-lock',?)
        ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body
        WHERE json_extract(cache.body,'$.until')<=? RETURNING key`)
        .bind(CACHE_KIND, lease, Date.now()).first();
      if (claimed) {
        try {
          // Another invocation may have finished between our read and claim.
          const latest = await this.read();
          if (latest && latest.session.id !== rejected?.id) return latest.session;
          await this.db.prepare("DELETE FROM cache WHERE kind=? AND key='current'").bind(CACHE_KIND).run();
          const session = await authenticate();
          if (isReusable(session)) {
            const body = await this.seal(session);
            await this.db.prepare(`INSERT INTO cache(kind,key,body)
              SELECT ?,'current',? WHERE EXISTS(SELECT 1 FROM cache WHERE kind=? AND key='login-lock' AND body=?)
              ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body`)
              .bind(CACHE_KIND, body, CACHE_KIND, lease).run();
          }
          return session;
        } finally {
          await this.db.prepare("DELETE FROM cache WHERE kind=? AND key='login-lock' AND body=?").bind(CACHE_KIND, lease).run();
        }
      }
      if (Date.now() >= deadline) {
        throw new AppError("Arcaea 会话正在刷新，请稍后重试。", 503, "ARCAEA_SESSION_BUSY");
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1000);
    }
  }

  async invalidate(rejected: ArcaeaSession) {
    const cached = await this.read();
    if (cached?.session.id === rejected.id) {
      // A late failure from an older request must not delete a newer login.
      await this.db.prepare("DELETE FROM cache WHERE kind=? AND key='current' AND body=?")
        .bind(CACHE_KIND, cached.body).run();
    }
  }

  private async read() {
    const row = await this.db.prepare("SELECT body FROM cache WHERE kind=? AND key='current'")
      .bind(CACHE_KIND).first<{ body: string }>();
    if (!row) return;
    try {
      const sealed = JSON.parse(row.body) as SealedSession;
      if (sealed.version !== 1 || typeof sealed.iv !== "string" || typeof sealed.data !== "string") return;
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(sealed.iv), additionalData: context },
        this.key, decode(sealed.data));
      const session = JSON.parse(new TextDecoder().decode(plain)) as ArcaeaSession;
      if (isReusable(session)) return { session, body: row.body };
    } catch {
      // Rotation, corruption or expiry is a cache miss, never a credential log.
    }
  }

  private async seal(session: ArcaeaSession) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context },
      this.key, encoder.encode(JSON.stringify(session)));
    return JSON.stringify({ version: 1, iv: encode(iv), data: encode(new Uint8Array(encrypted)) } satisfies SealedSession);
  }
}

function isReusable(session: ArcaeaSession) {
  return typeof session.id === "string" && typeof session.cookies === "string" && session.cookies.length > 0 &&
    !/[\r\n]/.test(session.cookies) && typeof session.expiresAt === "number" && Number.isFinite(session.expiresAt) &&
    session.expiresAt > Date.now() + EXPIRY_MARGIN_MS;
}

// Lowiro's persistent authentication cookie is `sid`. Companion cookies share
// its lifetime here; a session cookie without an explicit sid expiry is used
// only by the current client, rather than inventing a persistent lifetime.
export function sessionFromHeaders(headers: Headers): ArcaeaSession | undefined {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [];
  const setCookies = (values.length ? values : [headers.get("set-cookie") || ""])
    .flatMap(value => value.split(/,\s*(?=[^;,]+=)/));
  const cookies = new Map<string, string>();
  let expiresAt: number | undefined;
  for (const value of setCookies) {
    const [pair, ...attributes] = value.split(";");
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim(), content = pair.slice(index + 1).trim();
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n]/.test(content)) continue;
    cookies.set(name, content);
    if (name !== "sid") continue;
    const attrs = new Map(attributes.map(attribute => {
      const index = attribute.indexOf("=");
      return [attribute.slice(0, index < 0 ? undefined : index).trim().toLowerCase(), index < 0 ? "" : attribute.slice(index + 1).trim()];
    }));
    const maxAge = attrs.get("max-age");
    if (maxAge !== undefined && /^-?\d+$/.test(maxAge) && Number.isSafeInteger(Number(maxAge))) {
      expiresAt = Date.now() + Number(maxAge) * 1000;
    } else {
      const expiry = Date.parse(attrs.get("expires") || "");
      const serverTime = Date.parse(headers.get("date") || "");
      expiresAt = Number.isFinite(expiry) ? expiry + (Number.isFinite(serverTime) ? Date.now() - serverTime : 0) : undefined;
    }
  }
  if (!cookies.size || (cookies.has("sid") && (!cookies.get("sid") || (expiresAt !== undefined && expiresAt <= Date.now())))) return;
  return { id: crypto.randomUUID(), cookies: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
