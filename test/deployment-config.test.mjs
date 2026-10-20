import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, readConfig, requireDatabase } from '../scripts/lib/deployment-config.mjs';

test('private file presence does not silently select production', t => {
  const root = mkdtempSync(join(tmpdir(), 'arcaea-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'wrangler.production.jsonc'), '{}');
  assert.equal(configPath({}, root), join(root, 'wrangler.jsonc'));
  assert.equal(configPath({ ARCAEA_CONFIG: 'wrangler.production.jsonc' }, root), join(root, 'wrangler.production.jsonc'));
  assert.throws(() => readConfig(join(root, 'missing.jsonc')), /ENOENT/);
});

test('CI config is explicitly materialized and conflicting selectors fail', t => {
  const root = mkdtempSync(join(tmpdir(), 'arcaea-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { name: 'ci-instance', d1_databases: [{ binding: 'DB', database_id: 'test-id' }] };
  const file = configPath({ ARCAEA_CONFIG_JSON: JSON.stringify(config) }, root);
  assert.deepEqual(readConfig(file), config);
  assert.throws(() => configPath({ ARCAEA_CONFIG: file, ARCAEA_CONFIG_JSON: '{}' }, root), /only one/);
});

test('deployment requires a provisioned D1 database', () => {
  for (const config of [{}, { d1_databases: [] }, { d1_databases: [{ binding: 'DB', database_id: '00000000-0000-0000-0000-000000000000' }] }]) {
    assert.throws(() => requireDatabase(config), /Provision D1/);
  }
  assert.equal(requireDatabase({ d1_databases: [
    { binding: 'OTHER', database_id: 'other' },
    { binding: 'DB', database_id: 'selected' },
  ] }), 'selected');
});
