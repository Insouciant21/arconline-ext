import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listArchiveObjects, deleteArchiveObjects } from '../scripts/lib/archive.mjs';

test('R2 listing follows cursors even when a truncated page is empty', async () => {
  const calls = [];
  const pages = [
    { objects: [{ key: 'snapshots/a.json' }], truncated: true, cursor: 'first' },
    { objects: [], truncated: true, cursor: 'second' },
    { objects: [{ key: 'snapshots/b.json' }], truncated: false },
  ];
  const archive = { async list(options) { calls.push(options); return pages.shift(); } };
  const objects = [];
  for await (const object of listArchiveObjects(archive, 'snapshots/')) objects.push(object.key);
  assert.deepEqual(objects, ['snapshots/a.json', 'snapshots/b.json']);
  assert.deepEqual(calls.map(call => call.cursor), [undefined, 'first', 'second']);
  assert.ok(calls.every(call => call.prefix === 'snapshots/' && call.limit === 1000));
});

test('R2 listing rejects a repeated cursor instead of looping forever', async () => {
  const archive = { async list() { return { objects: [], truncated: true, cursor: 'same' }; } };
  await assert.rejects(async () => {
    for await (const object of listArchiveObjects(archive, 'snapshots/')) void object;
  }, /invalid pagination cursor/);
});

test('R2 deletion respects the batch limit and stops on failure', async () => {
  const keys = Array.from({ length: 2001 }, (_, i) => `key-${i}`), calls = [];
  await deleteArchiveObjects({ async delete(batch) { calls.push(batch); } }, keys);
  assert.deepEqual(calls.map(batch => batch.length), [1000, 1000, 1]);
  assert.deepEqual(calls.flat(), keys);
  let attempts = 0;
  await assert.rejects(deleteArchiveObjects({ async delete() { attempts++; throw new Error('offline'); } }, keys), /offline/);
  assert.equal(attempts, 1);
});
