import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { configuration } from './cloudflare.mjs';

// Maintenance commands deliberately target the real bucket. Normal app
// development keeps its local bindings; no S3 keys or app secrets are loaded.
export async function withArchive(callback) {
  const { account, config } = await configuration();
  const binding = config.r2_buckets?.find(item => item.binding === 'ARCHIVE');
  if (!account || !binding?.bucket_name) throw new Error('Configure account_id and the ARCHIVE binding in wrangler.jsonc');
  const directory = await mkdtemp(path.join(tmpdir(), 'arcaea-r2-'));
  let platform;
  try {
    const configPath = path.join(directory, 'wrangler.json');
    await writeFile(configPath, JSON.stringify({
      name: 'arcaea-r2-maintenance', account_id: account,
      compatibility_date: config.compatibility_date,
      r2_buckets: [{ ...binding, remote: true }],
    }));
    platform = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
    return await callback(platform.env.ARCHIVE);
  } finally {
    try { await platform?.dispose(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

export async function* listArchiveObjects(archive, prefix) {
  let cursor;
  do {
    const page = await archive.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    yield* page.objects;
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error('R2 returned an invalid pagination cursor');
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteArchiveObjects(archive, keys) {
  for (let index = 0; index < keys.length; index += 1000) {
    await archive.delete(keys.slice(index, index + 1000));
  }
}
