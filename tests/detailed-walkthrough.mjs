import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const folder = (process.env.QA_DOCS_ROOT || 'docs') + '/detailed-walkthrough';
const url = process.env.DESKTOP_QA_URL || 'http://127.0.0.1:4174/';
const browser = await chromium.launch({ channel:process.env.BROWSER_CHANNEL || 'msedge' });
const errors = [];
async function openBoard(target = url) {
  const context = await browser.newContext({viewport:{width:1200,height:880},locale:'en-US',timezoneId:'America/Toronto',acceptDownloads:true});
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(6000);
  // Keep the sample board day stable when regenerating the guide.
  await page.clock.setFixedTime(new Date('2026-11-20T17:00:00Z'));
  await page.goto(target);
  await page.getByRole('heading',{name:'Task board',exact:true}).waitFor();
  return page;
}
const button = (root,name) => root.getByRole('button',{name,exact:true});
const square = (p,i) => p.locator('[data-cell="'+i+'"]');
const dialog = p => p.getByRole('dialog');
const click = (p,name) => button(p,name).click();
const confirm = (p,name) => click(dialog(p),name);
async function shot(p,name,area) {
  await p.mouse.move(0,0);
  await area.screenshot({path:folder+'/'+name+'.png',animations:'disabled'});
}
async function restore(p,bytes,photograph=false) {
  await click(p,'Saves');
  const chooserEvent = p.waitForEvent('filechooser');
  await confirm(p,'Import a save');
  await (await chooserEvent).setFiles({name:'adhd-todo.sqlite',mimeType:'application/octet-stream',buffer:bytes});
  await button(dialog(p),'Replace boards').waitFor();
  if (photograph) await shot(p,'13-import-confirm',dialog(p));
  await confirm(p,'Replace boards');
  await p.getByRole('heading',{name:'Writing break',exact:true}).waitFor();
  await p.getByText('In progress',{exact:true}).waitFor();
  assert.ok(await p.locator('[data-cell="4"].done').isVisible());
  assert.equal(await p.locator('.counter b').innerText(),'2 pts');
}

try {
  await mkdir(folder,{recursive:true});
  const p = await openBoard();
  await click(p,'+ Board');
  await dialog(p).getByLabel('Board name').fill('Writing break'); await confirm(p,'Create board');
  await click(p,'Set up board');
  await click(p,'Board settings');
  await dialog(p).getByLabel('Default board').check();
  await dialog(p).getByLabel('Day starts at',{exact:true}).fill('06:30');
  await dialog(p).getByLabel('Standard weight').fill('3');
  await p.getByText('With one of each: Standard 75%, Low 25%.').waitFor();
  await shot(p,'01-draw-weights',dialog(p));
  await confirm(p,'Save settings');
  for (const [kind,i,target,title,priority,minutes] of [
    ['daily',0,0,'Draft a paragraph','Standard',30],
    ['daily',1,1,'Stretch','Low',5],
    ['temporary',0,4,'Send the outline','X',60],
  ]) {
    await p.locator('[data-library="'+kind+'"][data-slot="'+i+'"]').click();
    await dialog(p).getByLabel('Task name').fill(title);
    await dialog(p).locator('[name=priority][value="'+priority+'"]').check();
    await dialog(p).getByLabel('Planned minutes').fill(String(minutes));
    await confirm(p,'Save task');
    await p.locator('.libcell.selected').waitFor();
    await square(p,target).click();
    await square(p,target).getByText(title,{exact:true}).waitFor();
  }
  await shot(p,'02-libraries',p.locator('.libraries'));
  await click(p,'Start round');
  await button(p,'Draw a task').waitFor();
  await click(p,'Guide');
  const odds = p.locator('.guide-page section').filter({has:p.getByRole('heading',{name:'How the draw works'})});
  await odds.getByText(/There are 1 Must-do tasks/).waitFor();
  await shot(p,'03-must-do-odds',odds);
  await click(p,'Board'); await click(p,'Draw a task');
  await p.getByRole('heading',{name:'Selected task'}).waitFor();
  assert.equal(await square(p,4).getAttribute('aria-pressed'),'true');
  await click(p,'Complete task');
  await shot(p,'04-confirm-parent',dialog(p));
  await confirm(p,'Complete task');
  await p.getByText('2 pts',{exact:true}).waitFor();
  await click(p,'Guide');
  await odds.getByText(/Each Standard task has a 75% chance/).waitFor();
  await shot(p,'05-weighted-odds',odds);
  await click(p,'Board');
  await square(p,0).click({button:'right'});
  await shot(p,'06-task-menu',p.locator('.layout > section'));
  await click(p.locator('.task-menu'),'Task steps');
  await dialog(p).getByLabel('Side length').fill('2');
  await dialog(p).getByLabel('Side length').press('Tab');
  await dialog(p).getByLabel('Step 1 name').fill('Write a topic sentence');
  await dialog(p).getByLabel('Step 2 name').fill('Add an example');
  await dialog(p).getByLabel('Step 2 name').press('Tab');
  await shot(p,'07-write-steps',dialog(p));
  await confirm(p,'Save steps');
  await dialog(p).waitFor({state:'hidden'});
  await click(p,'Task steps');
  await confirm(p,'Step 1, Write a topic sentence'); await confirm(p,'Complete step');
  await shot(p,'08-confirm-step',dialog(p));
  await confirm(p,'Confirm completion');
  await dialog(p).getByText('1 of 2 steps completed').waitFor();
  await shot(p,'09-cleared-step',dialog(p));
  await confirm(p,'Close');
  await p.reload();
  await p.getByText('2 pts',{exact:true}).waitFor();
  await square(p,0).click();
  await shot(p,'10-resumed-board',p.locator('.layout'));
  await click(p,'Stats');
  await p.getByText('A day starts at 06:30, local time.').waitFor();
  await p.getByText('Completion log',{exact:true}).click();
  await shot(p,'11-completion-log',p.locator('.layout'));
  await click(p,'Saves');
  await shot(p,'12-board-saves',dialog(p));
  const download = p.waitForEvent('download');
  await confirm(p,'Download all boards');
  const bytes = await readFile(await (await download).path());
  assert.equal(bytes.subarray(0,15).toString(),'SQLite format 3');

  const copy = await openBoard(process.env.IMPORT_QA_URL || url);
  await restore(copy,bytes,true);
  await square(copy,0).click(); await click(copy,'Task steps');
  await dialog(copy).getByText('1 of 2 steps completed').waitFor();
  await confirm(copy,'Close');
  for (const [label,name] of [["Reset today's progress",'15-today'],['Reset all progress','16-all'],['Clear all squares','17-clear']]) {
    await click(copy,'Saves'); await confirm(copy,'Reset…');
    if(name==='15-today') await shot(copy,'14-reset-menu',dialog(copy));
    await confirm(copy,label);
    if(name==='15-today') assert.match(await dialog(copy).innerText(),/06:30 local time/);
    assert.equal(await copy.locator('dialog :focus').innerText(),'Cancel');
    await shot(copy,name,dialog(copy));
    await confirm(copy,'Cancel');
  }
  await click(copy,'End round'); await confirm(copy,'End round');
  await copy.getByRole('heading',{name:'Set up',exact:true}).waitFor();
  assert.equal(await copy.locator('.cell.done').count(),0);
  await shot(copy,'18-next-round',copy.locator('.layout'));
  await click(copy,'Start round'); await button(copy,'Draw a task').waitFor();
  await square(copy,0).click(); await click(copy,'Task steps');
  await dialog(copy).getByText('1 of 2 steps completed').waitFor();
  assert.deepEqual(errors,[]);
  console.log('18 screenshots captured. Weights, completion, steps, refresh, SQLite transfer, all three reset previews and next-round carryover verified.');
} finally { await browser.close(); }
