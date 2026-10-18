import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Explicit selection only: merely having a private file must not change builds.
// Workers Builds can supply the private config as an encrypted build variable.
export function configPath(env = process.env, root = projectRoot) {
  if (env.ARCAEA_CONFIG && env.ARCAEA_CONFIG_JSON) {
    throw new Error('Set only one of ARCAEA_CONFIG and ARCAEA_CONFIG_JSON');
  }
  if (env.ARCAEA_CONFIG_JSON) {
    const target = resolve(root, 'wrangler.production.jsonc');
    const config = JSON.parse(env.ARCAEA_CONFIG_JSON);
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    return target;
  }
  return resolve(root, env.ARCAEA_CONFIG || 'wrangler.jsonc');
}

export function readConfig(file = configPath()) {
  // Keep configs JSON-compatible so CLI tools and build secrets share a format.
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function requireDatabase(config) {
  const database = config.d1_databases?.find(item => item.binding === 'DB')?.database_id;
  if (!database || database.startsWith('00000000')) {
    throw new Error('Provision D1 first and set the DB database_id in the selected Wrangler config. See README.md.');
  }
  return database;
}
