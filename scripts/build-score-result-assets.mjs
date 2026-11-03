import { readdir, readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../src/assets/score-result/', import.meta.url);
const output = new URL('ui-pack.json', directory);
const files = (await readdir(directory)).filter(name => name.endsWith('.webp') && !name.startsWith('potential-')).sort();
// Preserve the original game bitmaps byte for byte; group small requests into
// one immutable asset without adding an image encoder or changing the pixels.
const entries = await Promise.all(files.map(async name => [name, `data:image/webp;base64,${(await readFile(new URL(name, directory))).toString('base64')}`]));
const content = JSON.stringify(Object.fromEntries(entries));
if (await readFile(output, 'utf8').catch(() => null) !== content) await writeFile(output, content);
