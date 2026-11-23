import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import initSqlJs from 'sql.js';
import { encode, readSave } from '../src/archive.ts';
import * as game from '../src/rules.ts';

const [webUrl, desktopUrl] = process.argv.slice(2);
const sql = await initSqlJs();
// Use the same software rasterizer for the two pages, including calendar cell edges.
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--force-color-profile=srgb']});
const button = (page,name)=>page.getByRole('button',{name,exact:true});
async function importFile(page,bytes,decision) {
  await page.locator('#import').setInputFiles({name:'transfer.sqlite',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await button(page.getByRole('dialog'),decision).click();
  await page.locator('dialog[open]').waitFor({state:'hidden'});
}
async function download(page,label) {
  await button(page,'Saves').click();
  const file=page.waitForEvent('download');
  await button(page.getByRole('dialog'),label).click();
  return readFile(await (await file).path());
}
try {
  const pages=await Promise.all([webUrl,desktopUrl].map(async url=>{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(url);
    await page.getByRole('heading',{name:'Sample board',exact:true}).waitFor();
    return page;
  }));
  const [web,desktop]=pages;
  const board=game.createBoard('Transfer test');
  board.daily.slots[0]={source:game.newId(),title:'Read',category:'Study',library:'daily',priority:'Standard',
    minutes:60,due:'',note:{text:'Remember page 3'},steps:{size:2,slots:[{title:'Chapter 1',done:true},null,null,null]}};
  game.place(board,'daily',0,0); game.place(board,'daily',0,1); game.start(board); game.complete(board,0);
  await importFile(web,encode(sql,game.workspace(board)),'Replace boards');
  await importFile(desktop,await download(web,'Download all boards'),'Replace boards');
  await Promise.all(pages.map(p=>p.waitForFunction(()=>!document.querySelector('#notice').textContent)));
  for (const name of ['Board','Set up','Stats']) {
    const shots=await Promise.all(pages.map(async p=>{
      await button(p,name).click();
      await p.mouse.move(0,0);
      await p.evaluate(()=>document.fonts.ready);
      return p.locator('main').screenshot({animations:'disabled'});
    }));
    if (!shots[0].equals(shots[1])) {
      for(const [i,shot] of shots.entries()) await writeFile(new URL('./.build/'+name+'-'+i+'.png',import.meta.url),shot);
      assert.equal(await web.locator('main').innerText(),await desktop.locator('main').innerText());
      assert.fail(name+' page pixels differ. Inspect windows/.build/'+name+'-{0,1}.png');
    }
  }
  await button(desktop,'Board').click();
  await desktop.locator('[data-cell="1"]').click();
  await button(desktop,'Complete task').click();
  await button(desktop.getByRole('dialog'),'Complete task').click();
  await desktop.getByText('4 pts',{exact:true}).waitFor();
  const single=await download(desktop,'Download current board');
  const singleBoard=readSave(sql,single);
  assert.equal(singleBoard.singleBoard,true);
  assert.equal(singleBoard.state.boards[0].history[1].note.text,'Remember page 3');
  assert.ok(singleBoard.state.boards[0].history[1].steps.slots[0].done);
  assert.ok(game.active(singleBoard.state.boards[0]).success);
  await importFile(web,single,'Add board');
  assert.equal(await web.locator('#boards option').count(),2);
  await web.getByText('4 pts',{exact:true}).waitFor();
  const full=await download(desktop,'Download all boards');
  await importFile(web,full,'Replace boards');
  assert.deepEqual(readSave(sql,await download(web,'Download all boards')).state,readSave(sql,full).state);
  console.log('Web → Windows → web: full save, single-board append, points, steps, notes and round history passed.');
  console.log('Board, Set up and Stats screenshots matched pixel for pixel at 1280 × 900.');
} finally { await browser.close(); }
