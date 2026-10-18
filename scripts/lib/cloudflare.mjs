import { readConfig, requireDatabase } from './deployment-config.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let tokenPromise;

export async function cfToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // Wrangler supports stored profiles/keyrings and refreshes expired OAuth tokens.
  // Capture its output privately; credentials must never reach migration logs.
  tokenPromise ||= (async () => {
    try {
      const { stdout } = await execute('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], { timeout: 60_000 });
      const { token } = JSON.parse(stdout);
      if (!token) throw new Error('Missing token');
      return token;
    } catch {
      tokenPromise = undefined;
      throw new Error('Run pnpm exec wrangler login or set CLOUDFLARE_API_TOKEN');
    }
  })();
  return tokenPromise;
}
export async function cf(pathname, options = {}, retried = false) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options, headers: { authorization: `Bearer ${await cfToken()}`, 'content-type': 'application/json', ...options.headers },
  });
  if (response.status === 401 && !process.env.CLOUDFLARE_API_TOKEN && !retried) {
    await response.body?.cancel();
    tokenPromise = undefined;
    return cf(pathname, options, true);
  }
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(`Cloudflare API ${response.status}: ${JSON.stringify(payload.errors || payload)}`);
  return payload.result;
}
export async function configuration() {
  const config = readConfig();
  return { account: process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id, database: config.d1_databases?.find(item => item.binding === 'DB')?.database_id, config };
}
export async function query(sql, params = []) {
  const { account, config } = await configuration();
  const database = requireDatabase(config);
  if (!account) throw new Error('Set CLOUDFLARE_ACCOUNT_ID or account_id in the selected Wrangler config');
  const result = await cf(`/accounts/${account}/d1/database/${database}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) });
  if (result.some(item => !item.success)) throw new Error('D1 query failed');
  return result[0]?.results || [];
}
