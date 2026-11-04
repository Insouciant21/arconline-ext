import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4321';
const token = process.env.SMOKE_TOKEN || (process.env.SMOKE_ENV_FILE ? parseEnv(await readFile(process.env.SMOKE_ENV_FILE, 'utf8')).ADMIN_TOKEN : 'local-test-token');
const directory = 'test-results/browser';
const referenceArtwork = process.env.SMOKE_ARTWORK_FILE ? await readFile(process.env.SMOKE_ARTWORK_FILE) : null;
const nameplateFixture = await readFile(new URL('../src/assets/score-result/user-panel.webp', import.meta.url));
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
  const exportAssets = [];
  const exportFonts = [];
  const partnerAssets = [];
  const nameplateAssets = [];
  let failPack = true, packRequests = 0;
  await page.route(/\/ui-pack(?:\.[^/?]+)?\.json(?:\?.*)?$/, route => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    packRequests++;
    return failPack ? route.fulfill({ status: 503, body: 'Temporary asset failure' }) : route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/result-(text|score|cjk|number).*woff2|score-result\/|background\..*webp|ui-pack.*json/.test(request.url())) exportAssets.push(request.url());
    if (request.resourceType() === 'font' && /result-(text|score|cjk|number).*woff2/.test(request.url())) exportFonts.push(request.url());
    if (request.resourceType() === 'image' && /\/(?:23u?|23u?-icon)(?:\.[^/]+)?\.webp/.test(request.url())) partnerAssets.push(request.url());
    if (request.url().includes('/api/media/banners/')) nameplateAssets.push(request.url());
  });
  await page.addInitScript(() => {
    window.__exportText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, x, y, ...rest) {
      window.__exportText.push({ value, x, y, font: this.font, width: this.measureText(value).width });
      return fillText.call(this, value, x, y, ...rest);
    };
  });
  await page.goto(origin + '/scores', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login?callbackUrl=%2Fscores');
  await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByPlaceholder('输入访问口令').fill(token);
  await page.getByRole('button', { name: '验证并进入' }).click();
  await page.waitForURL(origin + '/scores');
  await page.locator('astro-island:not([ssr])').waitFor();
  await expect(page.getByRole('link', { name: '单曲查询', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '查找一首歌' })).toBeVisible();

  let fail = true, recoverArtwork = false, failProfile = false, invalidProfile = false, useBasePartner = false;
  let profileRequests = 0;
  const requests = [];
  // Exercise the browser independently of subscription status and upstream changes.
  await page.route('**/api/score-export/profile', route => {
    expect(route.request().method()).toBe('POST');
    profileRequests++;
    if (invalidProfile) return route.fulfill({ status: 502, json: { error: '官网返回的用户资料不完整，请稍后重试。', code: 'EXPORT_PROFILE_INVALID' } });
    return failProfile ? route.fulfill({ status: 502, json: { error: '用户信息暂时不可用，请重试导出。' } }) : route.fulfill({ json: {
      characterAssetId: useBasePartner ? '23' : '23u', user: { name: 'Test Player · 咲弥', userCode: '123456789', rating: 12.939,
        characterId: 23, characterUncapped: true, characterUncappedOverride: useBasePartner, avatarImageUrl: '/api/media/characters/export-avatar.png',
        bannerId: useBasePartner ? 'course_banner_8' : 'online_banner_2026_10' },
      bannerImageUrl: `/api/media/banners/${useBasePartner ? 'changed' : 'equipped'}.png`,
    } });
  });
  // An unavailable cached avatar must use the matching native partner icon.
  await page.route('**/api/media/characters/export-avatar.png', route => route.fulfill({ status: 404, body: 'Avatar unavailable' }));
  await page.route('**/api/media/banners/*.png', route => route.fulfill({ contentType: 'image/webp', body: nameplateFixture }));
  await page.route('**/api/media/charts/song-search-test.svg', route => route.fulfill(referenceArtwork
    ? { contentType: 'image/jpeg', body: referenceArtwork }
    : { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6354b8"/><stop offset="1" stop-color="#8f3482"/></linearGradient></defs><path fill="url(#g)" d="M0 0h400v400H0z"/><path stroke="#fff" stroke-opacity=".35" fill="none" d="m200 40 140 240H60z"/><text x="200" y="320" fill="#fff" text-anchor="middle" font-size="26">AEGLESEEKER</text></svg>' }));
  await page.route('**/api/media/charts/export-retry.svg', route => recoverArtwork
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="#6255b8" d="M0 0h512v512H0z"/></svg>' })
    : route.fulfill({ status: 403, body: 'Media unavailable' }));
  await page.route(/\/api\/scores(?:\?|$)/, async route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(params));
    const term = params.get('term');
    await new Promise(resolve => setTimeout(resolve, 180));
    if (term === 'failure' && fail) { fail = false; return route.fulfill({ status: 502, json: { error: '官网暂时不可用，请重试。' } }); }
    if (term === 'missing') return route.fulfill({ json: { scores: [], count: 0 } });
    if (term === 'art-failure') return route.fulfill({ json: { scores: [{ ...score, imageUrl: '/api/media/charts/export-retry.svg' }], count: 1 } });
    if (term === 'eternal') return route.fulfill({ json: { scores: [{ ...score, songId: 'sayonarahatsukoi', difficulty: 4, title: { zh: '再见初恋 · さよなら初恋' } }], count: 1 } });
    if (term === 'Arcaea') {
      const page = Number(params.get('page'));
      return route.fulfill({ json: { scores: Array.from({ length: page === 2 ? 1 : 10 }, (_, index) => ({ ...score, songId: `song-${(page - 1) * 10 + index}`, title: { en: `Arcaea ${index + 1}` } })), count: 11 } });
    }
    return route.fulfill({ json: { scores: [{ ...score, ...(params.get('difficulty') === '3' ? { songId: 'dreadarea', difficulty: 3, difficultyAlias: 1, title: { en: 'Extradimensional Cosmic Phenomenon — Long Title' } } : {}) }], count: 1,
      exportHint: { rating: 12.939, characterId: 23, characterUncapped: true },
    } });
  });
  async function search(term) {
    await page.getByLabel('曲名或歌曲 ID').fill(term);
    await page.getByRole('button', { name: '查询成绩', exact: true }).click();
  }
  async function exportResult(name) {
    await page.evaluate(() => { window.__exportText = []; });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^[a-z0-9_-]+\.png$/i);
    const path = `${directory}/score-result-${name}.png`;
    await download.saveAs(path);
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([3124, 1440]);
    await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
    return page.evaluate(() => window.__exportText);
  }
  const difficultySelect = page.getByRole('combobox', { name: '谱面难度' });
  const sortSelect = page.getByRole('combobox', { name: '排序方式' });
  async function selectOption(control, option) {
    await control.click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await expect(control).toHaveText(option);
    await expect(page.getByRole('listbox')).toHaveCount(0);
  }
  await expect(difficultySelect).toHaveText('FTR · Future');
  await difficultySelect.focus();
  await difficultySelect.press('Enter');
  await expect(page.getByRole('option', { name: 'FTR · Future', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'ETR · Eternal', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(difficultySelect).toHaveText('ETR · Eternal');
  await expect(difficultySelect).toBeFocused();
  await difficultySelect.press('Enter');
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: 'PST · Past', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(difficultySelect).toHaveText('ETR · Eternal');
  await expect(difficultySelect).toBeFocused();
  await difficultySelect.click();
  const heading = await page.locator('#song-search-title').boundingBox();
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await selectOption(difficultySelect, 'FTR · Future');
  expect(requests).toHaveLength(0);
  await search('Aegleseeker');
  await expect(page.getByRole('button', { name: '查询中…' })).toBeDisabled();
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.locator('.score-number strong')).toHaveText('9,960,014');
  await expect(page.locator('.score-count-bonus')).toHaveText('(+1,469)');
  await expect(page.locator('.song-score-meta')).toContainText('年内游玩 8 次');
  await expect(page.locator('.score-potential strong')).toHaveText('11.2');
  await expect(page.locator('.score-potential')).toHaveAttribute('aria-label', '谱面定数 11.2');
  await expect(page.locator('.score-rating, .score-rank')).toHaveCount(0);
  await expect(page.locator('.score-song-id')).toHaveCount(0);
  expect(exportAssets).toEqual([]);
  expect(profileRequests).toBe(0);
  expect(nameplateAssets).toEqual([]);
  // Intent warms public assets without a profile request. A failed preload must
  // remain retryable, and later exports must reuse the successful asset pack.
  const packFailure = page.waitForResponse(response => response.status() === 503 && response.url().includes('ui-pack'));
  await page.getByRole('button', { name: '导出', exact: true }).hover();
  await packFailure;
  expect(profileRequests).toBe(0);
  // The saved hint starts the partner download before any fresh profile fetch.
  await expect.poll(() => partnerAssets.some(url => /\/23u(?:\.[^/]+)?\.webp/.test(url))).toBe(true);
  expect(packRequests).toBe(1);
  failPack = false;
  const referenceText = await exportResult('aegleseeker');
  expect(referenceText.map(item => item.value)).toEqual(expect.arrayContaining(['Aegleseeker', "09'960'014", '定数', '11.2', '单曲 PTT', '13.200', '1559', '(+1469)', '11', 'Test Player · 咲弥', '12.', '939', 'ArcOnline', 'Extension']));
  expect(Number.parseFloat(referenceText.find(item => item.value === '939').font)).toBeLessThan(Number.parseFloat(referenceText.find(item => item.value === '12.').font));
  expect(referenceText.map(item => item.value)).not.toContain('ArcOnline Extension');
  expect(referenceText.map(item => item.value).join(' ')).not.toMatch(/HIGH SCORE|MAX RECALL|FRAGMENT/);
  expect(exportAssets.length).toBeGreaterThan(0);
  expect(profileRequests).toBe(1);
  expect(packRequests).toBe(2);
  expect(nameplateAssets).toHaveLength(1);
  expect(nameplateAssets[0]).toContain('/equipped.png');
  expect(partnerAssets.some(url => /\/23u(?:\.[^/]+)?\.webp/.test(url))).toBe(true);
  expect(partnerAssets.some(url => /\/23u-icon(?:\.[^/]+)?\.webp/.test(url))).toBe(true);
  const fontRequests = exportFonts.length;
  expect(fontRequests).toBe(6);
  await page.screenshot({ path: `${directory}/song-search-desktop.png`, fullPage: true });

  await selectOption(difficultySelect, 'BYD / INS');
  await selectOption(sortSelect, '距理论值');
  await search('Dread & Area');
  await expect(page.locator('.difficulty-diamond')).toHaveText('INS');
  await expect(page.locator('.score-potential strong')).toHaveText('11.4');
  expect(requests.at(-1)).toEqual({ term: 'Dread & Area', difficulty: '3', page: '1', sort: 'score_below_max' });
  expect(new URL(page.url()).searchParams.get('term')).toBe('Dread & Area');
  useBasePartner = true;
  const insText = await exportResult('inscribed');
  expect(insText.map(item => item.value)).toEqual(expect.arrayContaining(['11', 'INSCRIBED', '11.4', '13.400']));
  expect(profileRequests).toBe(2);
  expect(packRequests).toBe(2);
  expect(nameplateAssets.at(-1)).toContain('/changed.png');
  expect(partnerAssets.some(url => /\/23(?:\.[^/]+)?\.webp/.test(url))).toBe(true);
  expect(insText.find(item => item.value.includes('Extradimensional')).width).toBeLessThanOrEqual(1150);
  expect(exportFonts).toHaveLength(fontRequests);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const art = page.locator('.score-art');
    const card = page.locator('.score-card');
    const artRect = await art.boundingBox(), cardRect = await card.boundingBox();
    const constantRect = await page.locator('.score-potential').boundingBox();
    expect(constantRect.x).toBeGreaterThanOrEqual(artRect.x);
    expect(constantRect.x + constantRect.width).toBeLessThanOrEqual(artRect.x + artRect.width + 1);
    if (width > 620) expect(Math.abs(artRect.width - artRect.height)).toBeLessThanOrEqual(1);
    else {
      expect(Math.abs(artRect.x - cardRect.x - 1)).toBeLessThanOrEqual(1);
      expect(Math.abs(artRect.y - cardRect.y - 1)).toBeLessThanOrEqual(1);
      await expect(page.locator('.score-title-copy h3')).toHaveCSS('white-space', 'nowrap');
    }
    const links = await page.locator('.topbar-actions > *').all();
    for (const link of links) await expect(link).toBeInViewport({ ratio: 1 });
    const triggerRect = await difficultySelect.boundingBox();
    await difficultySelect.click();
    const menu = page.getByRole('listbox');
    await expect(menu).toBeInViewport({ ratio: 1 });
    const menuRect = await menu.boundingBox();
    expect(Math.abs(menuRect.width - triggerRect.width)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('option', { name: 'BYD / INS', exact: true })).toHaveAttribute('data-state', 'checked');
    if (width === 1440 || width === 390) await page.screenshot({ path: `${directory}/song-search-dropdown-${width}.png` });
    await page.keyboard.press('Escape');
    await sortSelect.click();
    await expect(page.getByRole('listbox')).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    if (width === 390) await page.screenshot({ path: `${directory}/song-search-mobile.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectOption(difficultySelect, 'FTR · Future');
  await selectOption(sortSelect, '曲名');
  await search('Arcaea');
  await expect(page.locator('.score-card')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.locator('.song-search-pagination')).toContainText('第 2 / 2 页');
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await expect(page.locator('.score-potential strong')).toHaveCount(0);
  await expect(page.locator('.difficulty-diamond')).toHaveText('FTR');
  const missingConstantText = await exportResult('unlisted');
  expect(missingConstantText.filter(item => item.value === '—')).toHaveLength(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('曲名或歌曲 ID')).toHaveValue('Arcaea');
  await expect(difficultySelect).toHaveText('FTR · Future');
  await expect(sortSelect).toHaveText('曲名');
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
  await search('art-failure');
  await expect(page.locator('.score-art img')).toHaveAttribute('src', '/api/media/charts/export-retry.svg');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('曲绘加载失败');
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  recoverArtwork = true;
  await exportResult('retry');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await selectOption(difficultySelect, 'ETR · Eternal');
  await search('eternal');
  await expect(page.locator('.difficulty-diamond')).toHaveText('ETR');
  await expect(page.locator('.score-potential strong')).toHaveText('8.5');
  const eternalText = await exportResult('eternal-mobile');
  expect(eternalText.map(item => item.value)).toEqual(expect.arrayContaining(['8', 'ETERNAL', '8.5', '10.500', '再见初恋 · さよなら初恋']));
  failProfile = true;
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('用户信息暂时不可用');
  await expect(page.locator('.score-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  failProfile = false;
  invalidProfile = true;
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('用户资料不完整');
  await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  invalidProfile = false;
  await exportResult('profile-retry');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `${directory}/song-export-mobile.png`, fullPage: true });
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const touchPage = await touchContext.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(origin + '/scores', { waitUntil: 'domcontentloaded' });
  await touchPage.locator('astro-island:not([ssr])').waitFor();
  const touchDifficulty = touchPage.getByRole('combobox', { name: '谱面难度' });
  await touchDifficulty.tap();
  await expect(touchPage.getByRole('listbox')).toBeInViewport({ ratio: 1 });
  await touchPage.getByRole('option', { name: 'ETR · Eternal', exact: true }).tap();
  await expect(touchDifficulty).toHaveText('ETR · Eternal');
  await expect(touchPage.getByRole('listbox')).toHaveCount(0);
  await touchContext.close();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ origin, authenticated: true, search: true, export: { png: '3124x1440', constants: true, ptt: true, inscribed: true, eternal: true, missingConstant: true, retry: true, lazyAssets: true, profile: true, nativePartner: true, avatarFallback: true, partnerSwitch: true, equippedNameplate: true, nameplateSwitch: true }, filters: true, dropdown: { keyboard: true, escape: true, outsideClick: true, touch: true }, pagination: true, history: true, empty: true, retry: true, responsive: [320, 390, 768, 1440], pageErrors: errors.length }));
} finally { await browser.close(); }
