import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4321';
const token = process.env.SMOKE_TOKEN || (process.env.SMOKE_ENV_FILE ? parseEnv(await readFile(process.env.SMOKE_ENV_FILE, 'utf8')).ADMIN_TOKEN : 'local-test-token');
const directory = 'test-results/browser';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const score = {
  songId: 'aegleseeker', difficulty: 2, modifier: 0, score: 9960014,
  perfectCount: 1559, shinyPerfectCount: 1469, nearCount: 5, missCount: 4,
  clearType: 1, bestClearType: 5, yearlyPlayCount: 8, title: { en: 'Aegleseeker' },
  artist: 'Silentroom vs Frums', timePlayed: 1777211741898, imageUrl: '/api/media/charts/song-search-test.svg',
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/scores');
  await page.waitForURL('**/login?callbackUrl=%2Fscores');
  await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByPlaceholder('输入访问口令').fill(token);
  await page.getByRole('button', { name: '验证并进入' }).click();
  await page.waitForURL(origin + '/scores');
  await page.locator('astro-island:not([ssr])').waitFor();
  await expect(page.getByRole('link', { name: '单曲查询', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '查找一首歌' })).toBeVisible();

  let fail = true;
  const requests = [];
  // Exercise the browser independently of subscription status and upstream changes.
  await page.route('**/api/media/charts/song-search-test.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6354b8"/><stop offset="1" stop-color="#8f3482"/></linearGradient></defs><path fill="url(#g)" d="M0 0h400v400H0z"/><path stroke="#fff" stroke-opacity=".35" fill="none" d="m200 40 140 240H60z"/><text x="200" y="320" fill="#fff" text-anchor="middle" font-size="26">AEGLESEEKER</text></svg>' }));
  await page.route(/\/api\/scores(?:\?|$)/, async route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(params));
    const term = params.get('term');
    await new Promise(resolve => setTimeout(resolve, 180));
    if (term === 'failure' && fail) { fail = false; return route.fulfill({ status: 502, json: { error: '官网暂时不可用，请重试。' } }); }
    if (term === 'missing') return route.fulfill({ json: { scores: [], count: 0 } });
    if (term === 'Arcaea') {
      const page = Number(params.get('page'));
      return route.fulfill({ json: { scores: Array.from({ length: page === 2 ? 1 : 10 }, (_, index) => ({ ...score, songId: `song-${(page - 1) * 10 + index}`, title: { en: `Arcaea ${index + 1}` } })), count: 11 } });
    }
    return route.fulfill({ json: { scores: [{ ...score, ...(params.get('difficulty') === '3' ? { songId: 'dreadarea', difficulty: 3, difficultyAlias: 1, title: { en: 'Extradimensional Cosmic Phenomenon — Long Title' } } : {}) }], count: 1 } });
  });
  async function search(term) {
    await page.getByLabel('曲名或歌曲 ID').fill(term);
    await page.getByRole('button', { name: '查询成绩', exact: true }).click();
  }
  await search('Aegleseeker');
  await expect(page.getByRole('button', { name: '查询中…' })).toBeDisabled();
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.locator('.score-number strong')).toHaveText('9,960,014');
  await expect(page.locator('.score-count-bonus')).toHaveText('(+1,469)');
  await expect(page.locator('.song-score-meta')).toContainText('年内游玩 8 次');
  await expect(page.locator('.score-rating, .score-rank, .score-potential strong')).toHaveCount(0);
  await page.screenshot({ path: `${directory}/song-search-desktop.png`, fullPage: true });

  await page.getByLabel('谱面难度').selectOption('3');
  await page.getByLabel('排序方式').selectOption('score_below_max');
  await search('Dread & Area');
  await expect(page.locator('.difficulty-diamond')).toHaveText('INS');
  expect(requests.at(-1)).toEqual({ term: 'Dread & Area', difficulty: '3', page: '1', sort: 'score_below_max' });
  expect(new URL(page.url()).searchParams.get('term')).toBe('Dread & Area');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const art = page.locator('.score-art');
    const card = page.locator('.score-card');
    const artRect = await art.boundingBox(), cardRect = await card.boundingBox();
    if (width > 620) expect(Math.abs(artRect.width - artRect.height)).toBeLessThanOrEqual(1);
    else {
      expect(Math.abs(artRect.x - cardRect.x - 1)).toBeLessThanOrEqual(1);
      expect(Math.abs(artRect.y - cardRect.y - 1)).toBeLessThanOrEqual(1);
      await expect(page.locator('.score-title-copy h3')).toHaveCSS('white-space', 'nowrap');
    }
    const links = await page.locator('.topbar-actions > *').all();
    for (const link of links) await expect(link).toBeInViewport({ ratio: 1 });
    if (width === 390) await page.screenshot({ path: `${directory}/song-search-mobile.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('谱面难度').selectOption('2');
  await page.getByLabel('排序方式').selectOption('title');
  await search('Arcaea');
  await expect(page.locator('.score-card')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.locator('.song-search-pagination')).toContainText('第 2 / 2 页');
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('曲名或歌曲 ID')).toHaveValue('Arcaea');
  await expect(page.locator('.song-search-pagination')).toContainText('第 2 / 2 页');
  await page.goBack();
  await expect(page.locator('.score-card')).toHaveCount(10);
  await expect(page.locator('.song-search-pagination')).toContainText('第 1 / 2 页');
  await search('missing');
  await expect(page.getByRole('heading', { name: '未找到成绩' })).toBeVisible();
  await expect(page.locator('.score-card')).toHaveCount(0);
  await search('failure');
  await expect(page.getByRole('alert')).toContainText('官网暂时不可用，请重试。');
  await expect(page.getByRole('heading', { name: '未找到成绩' })).toHaveCount(0);
  await page.getByRole('button', { name: '重试查询' }).click();
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ origin, authenticated: true, search: true, filters: true, pagination: true, history: true, empty: true, retry: true, responsive: [320, 390, 768, 1440], pageErrors: errors.length }));
} finally { await browser.close(); }
