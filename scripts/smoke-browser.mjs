import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const origin=process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4321';
const token=process.env.SMOKE_TOKEN || (process.env.SMOKE_ENV_FILE ? parseEnv(await readFile(process.env.SMOKE_ENV_FILE,'utf8')).ADMIN_TOKEN : 'local-test-token');
const artifactDirectory='test-results/browser';
await mkdir(artifactDirectory,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 const exportAssets=[];
 page.on('request',request=>{if(/score-result-renderer|result-(text|score|cjk|number).*woff2|\/api\/score-export\/profile/.test(request.url()))exportAssets.push(request.url());});
 // Local D1 fixtures can reference covers that are only present in production R2.
 await page.route('**/api/media/charts/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="#6255b8" d="M0 0h512v512H0z"/></svg>'}));
 page.on('pageerror',error=>errors.push(error.message));
 async function signIn() {
  await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByPlaceholder('输入访问口令').fill(token);
  const responsePromise=page.waitForResponse(response=>response.url()===origin+'/api/auth/login'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'验证并进入'}).click();
  const response=await responsePromise;
  if(!response.ok())throw new Error(`Browser login failed (${response.status()}): ${(await response.text()).slice(0,200)}`);
  await page.waitForURL(origin+'/',{timeout:30000});
 }
 await page.goto(origin+'/');await page.waitForURL('**/login**');
 const loginMark=await page.locator('.auth-topbar .brand-mark').evaluate(element=>{const style=getComputedStyle(element);return{box:element.getBoundingClientRect().width,paths:element.querySelectorAll('path').length,circles:element.querySelectorAll('circle').length,background:style.backgroundColor,clipPath:style.clipPath}});
 if(loginMark.box<30||loginMark.paths<4||loginMark.circles<2||loginMark.background!=='rgba(0, 0, 0, 0)'||loginMark.clipPath!=='none')throw new Error(`Brand mark failed to render: ${JSON.stringify(loginMark)}`);
 await signIn();
 await page.locator('astro-island:not([ssr])').waitFor();
 await page.locator('.score-grid .score-card').first().waitFor({timeout:30000});
 const cards=await page.locator('.score-grid .score-card').count();if(cards!==50)throw new Error(`Expected 50 scores, got ${cards}`);
 await page.locator('astro-island:has(.score-card):not([ssr])').waitFor();
 await expect(page.locator('#b50 .score-export-button')).toHaveCount(50);
 await expect(page.locator('#b50 .score-song-id')).toHaveCount(0);
 expect(exportAssets).toEqual([]);
 const footerText=await page.locator('.footer').innerText();
 if(footerText!=='ArcOnline Extension')throw new Error(`Footer should only show the product name: ${JSON.stringify(footerText)}`);
 if(await page.title()!=='ArcOnline Extension')throw new Error(`Unexpected page title: ${await page.title()}`);
 if((await page.locator('.topbar .brand').innerText()).replace(/\s+/g,' ').trim()!=='ArcOnline EXTENSION')throw new Error('Sidebar brand name is stale');
 if(await page.getByText('CHART CONSTANT').count())throw new Error('Chart-constant label should be hidden');
 const avatarShape=await page.locator('.profile-avatar').evaluate(element=>{const style=getComputedStyle(element);return{clipPath:style.clipPath,filter:style.filter,background:style.backgroundColor,borderRadius:style.borderRadius,boxShadow:style.boxShadow,width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}});
 if(avatarShape.clipPath!=='none'||avatarShape.filter!=='none'||avatarShape.background!=='rgba(0, 0, 0, 0)'||avatarShape.borderRadius!=='0px'||avatarShape.boxShadow!=='none')throw new Error(`Profile avatar should have no decorative frame: ${JSON.stringify(avatarShape)}`);
 if(await page.locator('.section-block#potential').count())throw new Error('Potential section should not have an outer wrapper');
 await expect(page.locator('#potential.chart-panel')).toBeVisible();
 if(await page.locator('#potential > .hexagon-title').count())throw new Error('Potential section should not show an outer title');
 await expect(page.getByText('LONGITUDINAL VIEW',{exact:true})).toBeVisible();
 const cardLayout=await page.locator('.score-card').evaluateAll(items=>{
  const rectangles=items.map(card=>card.getBoundingClientRect());
  const firstTop=rectangles[0].top;
  const rowIndices=rectangles.map((rect,index)=>Math.abs(rect.top-firstTop)<1?index:-1).filter(index=>index>=0);
  const scoreBottoms=rowIndices.map(index=>items[index].querySelector('.score-result-row').getBoundingClientRect().bottom);
  const dateBottoms=rowIndices.map(index=>items[index].querySelector('.score-detail-row').getBoundingClientRect().bottom);
  const cardBottoms=rowIndices.map(index=>rectangles[index].bottom);
  const art=items[0].querySelector('.score-art').getBoundingClientRect();
  return {artWidth:art.width,artHeight:art.height,rowCards:rowIndices.length,scoreSpread:Math.max(...scoreBottoms)-Math.min(...scoreBottoms),dateSpread:Math.max(...dateBottoms)-Math.min(...dateBottoms),cardSpread:Math.max(...cardBottoms)-Math.min(...cardBottoms)};
 });
 if(Math.abs(cardLayout.artWidth-cardLayout.artHeight)>1)throw new Error(`Expected square cover art, got ${cardLayout.artWidth}x${cardLayout.artHeight}`);
 if(cardLayout.scoreSpread>1||cardLayout.dateSpread>1||cardLayout.cardSpread>1)throw new Error(`Score cards are not bottom aligned: ${JSON.stringify(cardLayout)}`);
 await expect(page.getByRole('link',{name:'历史',exact:true})).toBeInViewport({ratio:1});
 await expect(page.getByRole('button',{name:'退出',exact:true})).toBeInViewport({ratio:1});
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight/2));await page.waitForTimeout(100);
 const sidebarTop=await page.locator('.topbar').evaluate(element=>element.getBoundingClientRect().top);
 if(Math.abs(sidebarTop)>1)throw new Error(`Sidebar did not remain sticky while scrolling (top ${sidebarTop}px)`);
 await page.evaluate(()=>scrollTo(0,0));

 const baselineResponse=await context.request.get(origin+'/api/dashboard');
 expect(baselineResponse.ok()).toBe(true);
 const baseline=await baselineResponse.json();
 expect(baseline.activeJob).toBeNull();
 let failExportProfile=false;
 await page.route('**/api/score-export/profile',route=>failExportProfile
  ?route.fulfill({status:502,json:{error:'用户信息暂时不可用，请重试导出。'}})
  :route.fulfill({json:{characterAssetId:'23u',user:{name:'B50 Export Test',rating:12.939,characterId:23}}}));
 await page.evaluate(()=>{
  window.__exportText=[];
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(value,...args){window.__exportText.push(value);return original.call(this,value,...args);};
 });
 async function exportOverview(name){
  const card=page.locator('#b50 .score-card').first();
  const downloadEvent=page.waitForEvent('download',{timeout:60000});
  await card.getByRole('button',{name:'导出',exact:true}).click();
  const download=await downloadEvent;
  await download.saveAs(`${artifactDirectory}/overview-result-${name}.png`);
  const bytes=await readFile(`${artifactDirectory}/overview-result-${name}.png`);
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([3124,1440]);
  await expect(card.getByRole('button',{name:'导出',exact:true})).toBeEnabled();
  await expect(card.getByRole('alert')).toHaveCount(0);
 }
 await exportOverview('desktop');
 const firstScore=baseline.latest.best50[0];
 const firstCard=page.locator('#b50 .score-card').first();
 const bonus=await firstCard.locator('.score-count-bonus').textContent();
 expect(await page.evaluate(()=>window.__exportText)).toEqual(expect.arrayContaining([
  String(firstScore.score).padStart(8,'0').replace(/\B(?=(\d{3})+(?!\d))/g,"'"),
  firstScore.rating.toFixed(3),await firstCard.locator('.score-potential strong').textContent(),
  bonus.replaceAll(',',''),'B50 Export Test',
 ]));
 expect((await page.evaluate(()=>window.__exportText)).join(' ')).not.toMatch(/undefined|NaN/);
 await page.screenshot({path:`${artifactDirectory}/overview-export-desktop.png`});
 await page.getByRole('tab',{name:'1W',exact:true}).click();
 await expect(page.getByRole('tab',{name:'1W',exact:true})).toHaveAttribute('aria-selected','true');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Changing the chart or job progress must not reformat 50 unchanged cards.
 await page.evaluate(times=>{
  const playedAt=new Set(times), original=Intl.DateTimeFormat.prototype.formatToParts;
  window.__scoreFormattingCount=0;
  window.__restoreScoreFormatting=()=>{Intl.DateTimeFormat.prototype.formatToParts=original};
  Intl.DateTimeFormat.prototype.formatToParts=function(value){
   if(playedAt.has(Number(value)))window.__scoreFormattingCount++;
   return original.call(this,value);
  };
 },baseline.latest.best50.map(score=>score.timePlayed).filter(time=>time>0));
 await page.getByRole('tab',{name:'5Y',exact:true}).click();
 await expect(page.getByRole('tab',{name:'5Y',exact:true})).toHaveAttribute('aria-selected','true');
 if(await page.getByRole('button',{name:'放大',exact:true}).isEnabled()){
  await page.getByRole('button',{name:'放大',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看全部',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'查看全部',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看全部',exact:true})).toBeDisabled();
 }
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect(await page.evaluate(()=>window.__scoreFormattingCount)).toBe(0);

 const jobId='00000000-0000-4000-8000-000000000001';
 const syncUrl=origin+'/api/sync', jobUrl=origin+`/api/jobs/${jobId}`, dashboardUrl=origin+'/api/dashboard';
 const refreshed=structuredClone(baseline);
 refreshed.latest.best50[0].score++;
 let jobReads=0, dashboardReads=0, terminalJobReads=0, finishJob=false;
 // These routes keep the smoke test from submitting a real synchronization job.
 await page.route(syncUrl,route=>route.fulfill({status:202,json:{jobId,status:'queued'}}));
 await page.route(jobUrl,route=>{
  jobReads++;
  if(finishJob)terminalJobReads++;
  return route.fulfill({json:{id:jobId,kind:'sync',status:finishJob?'succeeded':'running',stage:finishJob?'done':'media',progress:{completed:finishJob?51:jobReads,total:51},createdAt:'',updatedAt:'',...(finishJob?{result:{snapshot:refreshed.latest,message:'浏览器同步测试完成'}}:{})}});
 });
 await page.route(dashboardUrl,route=>{
  dashboardReads++;
  return dashboardReads===1
   ?route.fulfill({status:503,json:{error:'Temporary dashboard failure'}})
   :route.fulfill({json:refreshed});
 });
 await page.getByRole('button',{name:'获取 B50 & 潜力图',exact:true}).click();
 await expect.poll(()=>jobReads,{timeout:10000}).toBeGreaterThanOrEqual(2);
 expect(dashboardReads).toBe(0);
 expect(await page.evaluate(()=>window.__scoreFormattingCount)).toBe(0);
 finishJob=true;
 await expect(page.locator('.job-status')).toContainText('暂时无法刷新概览',{timeout:10000});
 await expect(page.getByRole('dialog')).toContainText('浏览器同步测试完成',{timeout:10000});
 expect(dashboardReads).toBe(2);
 expect(terminalJobReads).toBe(1);
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.locator('.score-number strong').first()).toHaveText(new Intl.NumberFormat('en-US').format(refreshed.latest.best50[0].score));
 expect(await page.evaluate(()=>window.__scoreFormattingCount)).toBeGreaterThan(0);
 await page.evaluate(()=>window.__restoreScoreFormatting());
 await page.unroute(syncUrl);await page.unroute(jobUrl);await page.unroute(dashboardUrl);

 await page.getByRole('link',{name:'历史',exact:true}).click();await page.waitForURL('**/history');
 await page.locator('astro-island:not([ssr])').waitFor();
 const historyKickerGap=await page.locator('.history-intro .section-kicker').evaluate(kicker=>{const title=kicker.parentElement.querySelector('h1');return title.getBoundingClientRect().top-kicker.getBoundingClientRect().bottom});
 if(historyKickerGap<17)throw new Error(`History heading gap is too small: ${historyKickerGap}px`);
 if(await page.getByText(/D1 ARCHIVE \+ R2 BACKUP/).count())throw new Error('Snapshot source label should be hidden');
 if(await page.locator('.history-overview').count())throw new Error('History summary metrics should be hidden');
 if(await page.getByText('从D1 归档与 R2 备份中查看每次获取的 B50 快照。').count())throw new Error('History description should be hidden');
 const historyAlignment=await page.evaluate(()=>{const tabs=document.querySelector('.history-view-tabs button').getBoundingClientRect();const index=document.querySelector('.history-index').getBoundingClientRect();const second=document.querySelectorAll('.history-view-tabs button')[1].getBoundingClientRect();return{firstLeft:tabs.left,indexLeft:index.left,firstWidth:tabs.width,secondWidth:second.width}});
 if(Math.abs(historyAlignment.firstLeft-historyAlignment.indexLeft)>0.5)throw new Error(`History tabs are not aligned with the snapshot panel: ${JSON.stringify(historyAlignment)}`);
 await page.getByRole('button',{name:'对比两次历史'}).click();await page.getByRole('heading',{name:'历史对比',exact:true}).waitFor();
 await page.screenshot({path:`${artifactDirectory}/history-desktop.png`,fullPage:true});
 await page.getByRole('link',{name:'日志',exact:true}).click();await page.waitForURL('**/logs');
 await page.locator('astro-island:not([ssr])').waitFor();
 const logsKickerGap=await page.locator('.logs-intro .section-kicker').evaluate(kicker=>{const title=kicker.parentElement.querySelector('h1');return title.getBoundingClientRect().top-kicker.getBoundingClientRect().bottom});
 if(logsKickerGap<17)throw new Error(`Logs heading gap is too small: ${logsKickerGap}px`);
 if(await page.locator('.logs-description').count())throw new Error('Logs description should be hidden');
 await page.getByRole('button',{name:'退出',exact:true}).click();await page.waitForURL('**/login');
 await page.setViewportSize({width:390,height:844});
 await signIn();
 await page.locator('.score-grid .score-card').first().waitFor();await page.screenshot({path:`${artifactDirectory}/dashboard-mobile.png`,fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Mobile horizontal overflow');
 await page.setViewportSize({width:320,height:900});
 await page.locator('astro-island:has(.score-card):not([ssr])').waitFor();
 failExportProfile=true;
 await page.locator('#b50 .score-export-button').first().click();
 await expect(page.locator('#b50 .score-card').first().getByRole('alert')).toContainText('用户信息暂时不可用');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
 failExportProfile=false;
 await exportOverview('mobile');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
 await page.locator('#b50 .score-card').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:`${artifactDirectory}/overview-export-mobile.png`});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({origin,cards,login:true,historyComparison:true,logout:true,mobile:true,export:{png:'3124x1440',b50:true,lazyAssets:true,shinyPure:true,ptt:true,retry:true,responsive:320},cardMemoization:true,polling:{jobReads,dashboardReads,terminalJobReads},pageErrors:errors.length}));
} finally {await browser.close();}
