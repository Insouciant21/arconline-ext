import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const origin=process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4321';
const token=process.env.SMOKE_TOKEN || (process.env.SMOKE_ENV_FILE ? parseEnv(await readFile(process.env.SMOKE_ENV_FILE,'utf8')).ADMIN_TOKEN : 'local-test-token');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
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
 await signIn();
 await page.locator('.score-grid .score-card').first().waitFor({timeout:30000});
 const cards=await page.locator('.score-grid .score-card').count();if(cards!==50)throw new Error(`Expected 50 scores, got ${cards}`);
 await expect(page.getByRole('link',{name:'历史',exact:true})).toBeInViewport({ratio:1});
 await expect(page.getByRole('button',{name:'退出',exact:true})).toBeInViewport({ratio:1});
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight/2));await page.waitForTimeout(100);
 const sidebarTop=await page.locator('.topbar').evaluate(element=>element.getBoundingClientRect().top);
 if(Math.abs(sidebarTop)>1)throw new Error(`Sidebar did not remain sticky while scrolling (top ${sidebarTop}px)`);
 await page.evaluate(()=>scrollTo(0,0));
 await page.getByRole('link',{name:'历史',exact:true}).click();await page.waitForURL('**/history');
 await page.locator('astro-island:not([ssr])').waitFor();await page.getByRole('button',{name:'对比两次历史'}).click();await page.getByRole('heading',{name:'历史对比',exact:true}).waitFor();
 await page.screenshot({path:'.migration/history-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'日志',exact:true}).click();await page.waitForURL('**/logs');
 await page.locator('astro-island:not([ssr])').waitFor();await page.getByRole('button',{name:'退出',exact:true}).click();await page.waitForURL('**/login');
 await page.setViewportSize({width:390,height:844});
 await signIn();
 await page.locator('.score-grid .score-card').first().waitFor();await page.screenshot({path:'.migration/dashboard-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Mobile horizontal overflow');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({origin,cards,login:true,historyComparison:true,logout:true,mobile:true,pageErrors:errors.length}));
} finally {await browser.close();}
