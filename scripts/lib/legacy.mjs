import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const localDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function fingerprint(snapshot) {
  return JSON.stringify(snapshot.best50.map(score => ({ songId: score.songId, difficulty: score.difficulty, modifier: score.modifier, rating: score.rating, score: score.score, perfectCount: score.perfectCount, nearCount: score.nearCount, missCount: score.missCount, clearType: score.clearType, title: Object.fromEntries(Object.entries(score.title || {}).sort(([a], [b]) => a.localeCompare(b))), artist: score.artist, timePlayed: score.timePlayed, bg: score.bg || null })));
}
export function validSnapshot(value) {
  return value && typeof value.id === 'string' && /^[\w.-]+$/.test(value.id) && Number.isFinite(Date.parse(value.fetchedAt)) &&
    Number.isFinite(value.potential) && Number.isFinite(value.weightedPotential) && value.user && Array.isArray(value.best50) &&
    value.best50.length > 0 && value.best50.length <= 50 && value.best50.every(score => typeof score.songId === 'string' && Number.isFinite(score.rating) && Number.isFinite(score.score) && Number.isInteger(score.difficulty));
}
export function preferSnapshot(left, right) {
  const rank = s => (s.mediaStatus === 'complete' ? 1000 : 0) + (s.potentialImageKey ? 1 : 0) + (s.user.avatarImageKey ? 1 : 0) + s.best50.filter(score => score.imageKey).length;
  return rank(right) > rank(left) ? right : left;
}
export async function readOptional(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${file}: ${error.message}`); }
}
export async function readLegacy(directory) {
  const result = { snapshots: [], points: [], charts: {}, characters: {}, aliases: {}, logs: [] };
  result.snapshots.push(...await readOptional(path.join(directory, 'b50-history.json'), []));
  const latest = await readOptional(path.join(directory, 'latest.json'), null);
  if (latest) result.snapshots.push(latest);
  let names = [];
  try { names = await readdir(path.join(directory, 'snapshots')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names.filter(name => name.endsWith('.json'))) result.snapshots.push(await readOptional(path.join(directory, 'snapshots', name), null));
  result.points.push(...await readOptional(path.join(directory, 'ptt-history.json'), []));
  result.points.push(...(await readOptional(path.join(directory, 'official-ptt-history.json'), [])).map(point => ({ ...point, source: 'lowiro' })));
  result.charts = await readOptional(path.join(directory, 'chart-images.json'), {});
  result.characters = await readOptional(path.join(directory, 'character-images.json'), {});
  result.aliases = await readOptional(path.join(directory, 'chart-aliases.json'), {});
  result.logs = await readOptional(path.join(directory, 'logs.json'), []);
  return result;
}
export function mergeLegacy(sources) {
  const snapshots = new Map(), points = new Map(), logs = new Map(), charts = {}, characters = {}, aliases = {}, conflicts = [];
  for (const { name, data } of sources) {
    for (const snapshot of data.snapshots) {
      if (!validSnapshot(snapshot)) throw new Error(`Invalid snapshot in ${name}: ${snapshot?.id || '<missing id>'}`);
      const previous = snapshots.get(snapshot.id);
      if (previous && fingerprint(previous) !== fingerprint(snapshot)) conflicts.push({ id: snapshot.id, source: name, reason: 'B50 differs for same snapshot ID' });
      snapshots.set(snapshot.id, previous ? preferSnapshot(previous, snapshot) : snapshot);
    }
    for (const point of data.points) {
      if (!Number.isFinite(Date.parse(point.fetchedAt)) || !Number.isFinite(point.potential)) throw new Error(`Invalid history point in ${name}`);
      const id = point.source === 'lowiro' ? `lowiro:${point.fetchedAt}` : point.snapshotId ? `snapshot:${point.snapshotId}` : `legacy:${point.fetchedAt}`;
      const previous = points.get(id);
      if (!previous || point.potential > previous.potential) points.set(id, { ...point, date: localDate(point.fetchedAt) });
    }
    for (const entry of Object.values(data.charts)) {
      const key = entry.bg || entry.songId;
      if (key && (!charts[key] || entry.updatedAt > charts[key].updatedAt)) charts[key] = entry;
    }
    for (const entry of Object.values(data.characters)) {
      const key = `${entry.characterId}:${entry.icon || ''}`;
      if (!characters[key] || entry.updatedAt > characters[key].updatedAt) characters[key] = entry;
    }
    Object.assign(aliases, data.aliases);
    for (const entry of data.logs) if (entry.id && entry.timestamp) logs.set(entry.id, entry);
  }
  for (const snapshot of snapshots.values()) {
    points.set(`snapshot:${snapshot.id}`, { date: localDate(snapshot.fetchedAt), fetchedAt: snapshot.fetchedAt, potential: snapshot.potential, snapshotId: snapshot.id });
    for (const score of snapshot.best50) {
      if (score.difficultyAlias !== undefined) aliases[`${score.songId}:${score.difficulty}`] = score.difficultyAlias;
      if (score.imageKey && score.bg && !charts[score.bg]) charts[score.bg] = { songId: score.songId, bg: score.bg, imageKey: score.imageKey, imageUrl: score.imageUrl, updatedAt: snapshot.fetchedAt };
    }
    const user = snapshot.user, key = `${user.characterId}:${user.characterIcon || ''}`;
    if (user.avatarImageKey && user.characterId !== undefined && !characters[key]) characters[key] = { characterId: user.characterId, icon: user.characterIcon, imageKey: user.avatarImageKey, imageUrl: user.avatarImageUrl, updatedAt: snapshot.fetchedAt };
  }
  const daily = new Map();
  for (const point of points.values()) { const old = daily.get(point.date); if (!old || point.potential > old.potential || point.potential === old.potential && point.fetchedAt > old.fetchedAt) daily.set(point.date, point); }
  return { snapshots: [...snapshots.values()].sort((a,b) => a.fetchedAt.localeCompare(b.fetchedAt)), points, charts, characters, aliases, logs: [...logs.values()].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).slice(0,500), daily: [...daily.values()].sort((a,b) => a.date.localeCompare(b.date)), conflicts };
}
