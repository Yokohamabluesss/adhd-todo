import {test} from 'node:test';
import assert from 'node:assert/strict';
import init from 'sql.js';
import * as g from '../src/rules.ts';
import {decode,encode} from '../src/archive.ts';
import {readMetrics} from '../src/metrics.ts';
import {cohortTable} from '../src/activity-history.ts';
import {readFile} from 'node:fs/promises';

const sql=await init();
const day1=new Date(2026,10,17,9),day2=new Date(2026,10,18,9);
function board(){
  const b=g.createBoard('Personal');
  b.daily.slots[0]={source:g.newId(),title:'Read',library:'daily',category:'Study',priority:'Standard',minutes:10,due:''};
  return b;
}
function report(b,filter='All'){return readMetrics(sql,encode(sql,g.workspace(b)),b.id,filter).activity;}

test('first suggestions match placements, split eligible pools, and distinguish redraw, early stop and pending',()=>{
  const b=board();
  g.place(b,'daily',0,0,+day1);g.place(b,'daily',0,1,+day1);
  g.start(b,day1);g.recordDraw(b,0,+day1);g.complete(b,1,+day1);g.finish(b,+day1);
  g.start(b,day1);g.recordDraw(b,0,+day1);g.recordDraw(b,0,+day1);
  g.complete(b,0,+day1);g.finish(b,+day1);
  g.place(b,'daily',0,0,+day2);g.start(b,day2);
  g.recordDraw(b,0,+day2);g.finish(b,+day2);
  g.start(b,day2);g.recordDraw(b,0,+day2);g.complete(b,0,+day2+120000);g.finish(b,+day2+120000);
  g.place(b,'daily',0,0,+day2);g.start(b,day2);g.recordDraw(b,0,+day2);
  const a=report(b);
  assert.deepEqual(a.adoption,[
    {single:false,outcome:'Not adopted',n:1},{single:true,outcome:'Adopted',n:1},
    {single:true,outcome:'Not adopted',n:2},{single:true,outcome:'Pending',n:1}]);
  assert.deepEqual(a.squares,[{size:3,square:0,first:5,all:6}]);
  assert.deepEqual(a.timing,[{completed:0,draws:6,redraws:1,shuffles:0}]);
  assert.deepEqual(a.latency,{medianMinutes:0,observed:3,noFinish:2});
});
test('cohorts follow placement day across round-day outcomes, with removals, live work and intake-only days',()=>{
  const b=board();g.recordEvent(b,'created',{source:b.daily.slots[0].source,library:'daily',category:'Study',priority:'Standard'},+day1);
  for(const i of [0,1,2,3]) g.place(b,'daily',0,i,+day1);
  g.start(b,day1);g.finish(b,+day1);
  g.start(b,day2);
  for(const i of [0,1,2]) g.complete(b,i,+day2);
  g.finish(b,+day2);g.removeFromBoard(b,3);
  g.place(b,'daily',0,0,+day2+86400000);
  const a=report(b,'Unfinished');
  const counts=Object.fromEntries(a.intake.map(r=>[r.outcome,r.n]));
  assert.deepEqual(counts,{Created:1,Completed:3,Removed:1});
  assert.deepEqual(a.gaps.map(g=>g.label),['3']);
  assert.match(cohortTable(a,'library','2026-11-17','2026-11-17'),/75%/);
  assert.match(cohortTable(a,'day','2026-11-18',''),/No recorded/);
  assert.equal(report(b,'Success').intake.length,0);
  assert.equal(report(b).intake.find(r=>r.outcome==='On board').n,1);
});
test('a persistent or reformed line counts once per round per size and shuffle timing includes free shuffles',()=>{
  const b=board(); for(const i of [0,1,2,3])g.place(b,'daily',0,i,+day1);
  g.start(b,day1);
  for(const i of [0,1,2,3])g.complete(b,i,+day1);
  g.finish(b,+day1);g.resizeBoard(b,2);
  g.place(b,'daily',0,0,+day2);g.place(b,'daily',0,1,+day2);g.start(b,day2);
  g.shuffle(b,()=>0,+day2);
  for(let i=0;i<4;i++)if(g.isTask(b.cells[i]))g.complete(b,i,+day2);
  const a=report(b);
  assert.deepEqual(a.lines.find(l=>l.size===3),{size:3,cells:[0,1,2],n:1});
  assert.ok(a.lines.some(l=>l.size===2));
  assert.equal(a.timing.find(t=>t.completed===0).shuffles,1);
});
test('older files preserve existing category choices and show only observed activity',async()=>{
  const bytes=await readFile(new URL('./fixtures/v1-board.sqlite',import.meta.url));
  const {boards:[b]}=decode(sql,bytes);
  const before=g.boardCategories(b);
  assert.ok(before.length>0);
  g.resetBoard(b,'all');g.resetBoard(b,'grid');b.daily.slots.fill(null);b.temporary.slots.fill(null);
  assert.deepEqual(g.boardCategories(decode(sql,encode(sql,g.workspace(b))).boards[0]),before);
  const a=readMetrics(sql,bytes,b.id,'All').activity;
  assert.deepEqual(a.adoption,[]);assert.deepEqual(a.intake,[]);assert.deepEqual(a.squares,[]);
});
