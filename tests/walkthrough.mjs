import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const directory = (process.env.QA_DOCS_ROOT || 'docs') + '/walkthrough';
const lan = process.argv.find(arg => arg.startsWith('--lan='))?.slice(6);
const desktopUrl = process.env.DESKTOP_QA_URL || 'http://127.0.0.1:4174';
const mobileUrl = process.env.TOUCH_QA_URL || (lan ? 'http://' + lan + ':4175' : desktopUrl);
let server;
let browser;

async function play(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? {width:390,height:844} : {width:1280,height:900},
    isMobile:mobile, hasTouch:mobile, acceptDownloads:true,
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(7000);
    await page.goto(mobile ? mobileUrl : desktopUrl);
    if (mobile && lan) assert.equal(await page.evaluate(() => window.isSecureContext),false);
    const cell = i => page.locator('[data-cell="'+i+'"]');
    const dialog = page.getByRole('dialog');
    const action = key => page.locator('[data-action="'+key+'"]');
    const press = locator => mobile ? locator.tap() : locator.click();
    const ok = text => press(dialog.getByRole('button',{name:new RegExp('^'+text)}));
    const shot = async (name,locator) => {
      if (mobile !== name.startsWith('mobile')) return;
      if (!mobile) await page.mouse.move(0,0);
      await locator.screenshot({path:directory+'/'+name+'.png',animations:'disabled'});
    };
    await press(action('new-board'));
    await dialog.getByLabel('Board name').fill('First round'); await ok('Create board');
    await press(page.getByRole('button',{name:/^Set up board/}));
    const tasks = [
      ['daily',0,0,'Read one page','Standard',30],
      ['daily',1,1,'Stretch','Low',5],
      ['daily',2,2,'Water a plant','Low',5],
      ['temporary',0,4,'Send an outline','X',60],
    ];
    for (const [kind,slot,index,title,priority,minutes] of tasks) {
      await press(page.locator('[data-library="'+kind+'"][data-slot="'+slot+'"]'));
      await dialog.getByLabel('Task name').fill(title);
      await press(dialog.locator('[name=priority][value="'+priority+'"]'));
      await dialog.getByLabel('Planned minutes').fill(String(minutes));
      if (priority === 'X') {
        const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
        await dialog.getByLabel('Due date').fill(today);
        await shot('01-add-task',dialog);
      }
      await ok('Save task');
      await page.locator('.libcell.selected').waitFor();
      await press(cell(index));
      await cell(index).getByText(title,{exact:true}).waitFor();
    }
    await shot('02-setup',page.locator('main'));
    await press(action('start'));
    await press(action('draw'));
    await page.getByRole('heading',{name:/^Selected task/}).waitFor();
    assert.equal(await cell(4).getAttribute('aria-pressed'),'true');
    await page.waitForFunction(() => document.querySelector('#notice').textContent === '',null,{timeout:10000});
    await shot('03-draw',page.locator('.layout'));
    await shot('mobile-board',page.locator('.layout > section'));
    await press(action('steps'));
    await dialog.getByLabel('Side length').fill('2');
    await dialog.getByLabel('Side length').press('Tab');
    await dialog.getByLabel('Step 1 name').fill('Write one heading');
    await dialog.getByLabel('Step 2 name').fill('Add one example');
    await ok('Save steps');
    await dialog.waitFor({state:'hidden'});
    await press(action('steps'));
    await ok('Step 1, Write one heading');
    await ok('Complete step');
    await ok('Confirm completion');
    await dialog.getByText('1 of 2 steps completed',{exact:true}).waitFor();
    assert.ok(await dialog.getByRole('button',{name:/^Step 1, Completed/}).isDisabled());
    await shot('04-small-step',dialog);
    await ok('Close');
    assert.ok(await cell(4).getByText('Send an outline').isVisible());
    assert.ok(await page.getByText('0 pts',{exact:true}).isVisible());
    for (const i of [0,1,2]) {
      await press(cell(i)); await press(action('complete')); await ok('Complete task');
      await page.locator('[data-cell="'+i+'"].done').waitFor();
    }
    assert.equal(await page.locator('.cell.winning').count(),3);
    await shot('05-bingo',page.locator('.layout'));
    await press(action('finish'));
    await dialog.getByText(/There are still must-do tasks/).waitFor();
    await shot('06-end-warning',dialog);
    await ok('Keep going');
    await page.reload();
    await page.locator('#boards').selectOption({label:'First round'});
    await page.locator('.winning').first().waitFor();
    await press(cell(4)); await press(action('complete')); await ok('Complete task');
    await page.getByText('5 pts',{exact:true}).waitFor();
    await press(action('finish')); await ok('End round');
    await action('settings').waitFor();
    await press(action('tab-Stats'));
    await page.getByText('Success',{exact:true}).waitFor();
    await page.getByText('4 total',{exact:true}).waitFor();
    await shot('07-stats',page.locator('main'));
    await press(action('save-menu'));
    const downloaded = page.waitForEvent('download');
    await ok('Download all boards');
    const bytes = await readFile(await (await downloaded).path());
    assert.equal(bytes.subarray(0,15).toString(),'SQLite format 3');
    await press(action('tab-Guide'));
    await page.locator('.guide-intro').getByText(/Enjoy your round!/).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /\p{Script=Han}/u);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors,[]);
    console.log((mobile ? 'Touch / '+mobileUrl : 'Desktop / '+desktopUrl) + ' passed: steps, Bingo, warning, manual finish, 5 points, history and SQLite download.');
  } finally { await context.close(); }
}

try {
  if (lan) {
    // Bind only to the chosen LAN address. Stop our own preview after the two runs.
    server = spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host',lan,'--port','4175','--strictPort'],{stdio:'inherit',windowsHide:true});
    let ready = false;
    for (let attempt=0; attempt<30 && !ready; attempt++) {
      await delay(200);
      if (server.exitCode !== null) throw new Error('LAN preview exited');
      try { ready = (await fetch(mobileUrl,{signal:AbortSignal.timeout(1000)})).ok; } catch { /* Starting */ }
    }
    assert.ok(ready,'LAN preview is reachable');
  }
  await mkdir(directory,{recursive:true});
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
  await play(false);
  await play(true);
} finally {
  if (server) server.kill();
  await browser?.close();
}
