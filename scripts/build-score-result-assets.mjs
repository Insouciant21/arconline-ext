import { readFile, writeFile } from 'node:fs/promises';
import common from '../src/lib/score-result-ui.json' with { type: 'json' };

const directory = new URL('../src/assets/score-result/', import.meta.url);
const output = new URL('ui-pack.json', directory);
const files = [...common].sort();
// Preserve the original game bitmaps byte for byte; group small requests into
// one immutable asset. Grades, clear types and difficulty badges are requested
// individually, so an export never downloads every unused visual variant.
const entries = await Promise.all(files.map(async name => [name, `data:image/webp;base64,${(await readFile(new URL(name, directory))).toString('base64')}`]));
const content = JSON.stringify(Object.fromEntries(entries));
if (await readFile(output, 'utf8').catch(() => null) !== content) await writeFile(output, content);
