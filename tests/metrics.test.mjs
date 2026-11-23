import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init from 'sql.js';
import * as g from '../src/rules.ts';
import {encode,decode} from '../src/archive.ts';
import {readMetrics} from '../src/metrics.ts';
import {sampleBoard,updateSavedSample} from '../src/sample.ts';

const sql=await init();
const task=(name,category='')=>({source:g.newId(),title:name,category,library:'daily',priority:'Standard',due:'',minutes:30});
const bytes=b=>encode(sql,{boards:[b],defaultId:b.id});
test('SQL day filter keeps every round on a successful day and includes zeroes in finished-round summaries',()=>{
  const b=g.createBoard('Metrics'), other=sampleBoard(new Date(2026,10,20));
  const one=new Date(2026,10,18,10),two=new Date(2026,10,19,11),three=new Date(2026,10,20,11);
  b.daily.slots[0]=task('Read');
  g.place(b,'daily',0,0,+one); g.start(b,one); g.finish(b,+one);
  g.start(b,one); g.complete(b,0,+one); g.finish(b,+one);
  g.place(b,'daily',0,0,+two); g.start(b,two); g.finish(b,+two); g.start(b,three);
  const data=encode(sql,{boards:[b,other],defaultId:b.id});
  const m=readMetrics(sql,data,b.id,'All');
  assert.equal(m.total,1);assert.equal(m.rounds.length,4);
  assert.equal(m.median,0);assert.equal(m.mean,1/3);assert.deepEqual(m.modes,[0]);
  assert.deepEqual(m.byCategory,[{name:'Uncategorized',n:1}]);
  assert.deepEqual(m.byLibrary,[{name:'daily',n:1}]);
  const success=readMetrics(sql,data,b.id,'Success');
  assert.equal(success.rounds.length,2);assert.equal(success.median,0.5);assert.deepEqual(success.modes,[0,1]);
  assert.equal(readMetrics(sql,data,b.id,'Unfinished').rounds.length,1);
});
test('placements, returns, draw results, paid shuffles and end distances survive SQLite and follow resets',()=>{
  const b=g.createBoard('events'), day=new Date(2026,10,20,9);
  b.daily.slots[0]=task('Same'); b.temporary.slots[0]={...task('Once'),library:'temporary'};
  g.place(b,'daily',0,0,+day);g.place(b,'daily',0,1,+day);g.place(b,'temporary',0,4,+day);
  const [a,c]=b.cells;assert.notEqual(a.placement,c.placement);
  const old=b.cells[4].placement;g.removeFromBoard(b,4);g.place(b,'temporary',0,4,+day);
  assert.notEqual(b.cells[4].placement,old);
  g.start(b,day);g.recordDraw(b,0,+day);g.complete(b,1,+day);
  g.shuffle(b,()=>0,+day);g.finish(b,+day);
  const restored=decode(sql,bytes(b)).boards[0];
  assert.deepEqual(restored.events,b.events);
  assert.equal(restored.history[0].placement,c.placement);
  assert.equal(b.events.find(e=>e.kind==='drawn').data.placement,a.placement);
  assert.equal(b.events.at(-1).data.remaining,2);
  const item=restored.cells.find(t=>t?.placement===a.placement);assert.ok(item);
  g.start(restored,day);g.resetBoard(restored,'today',day);
  assert.ok(restored.events.every(e=>e.day!==g.roundDay(day)));
  g.resetBoard(restored,'all');assert.deepEqual(restored.events,[]);
});
test('old saves get real historical metrics without invented placement or draw records',async()=>{
  const file=await readFile(new URL('./fixtures/v1-board.sqlite',import.meta.url));
  const legacy=decode(sql,file), b=legacy.boards[0];
  assert.deepEqual(b.events,[]);
  assert.equal(readMetrics(sql,file,b.id,'All').total,b.history.length);
  const after=decode(sql,bytes(b)).boards[0];
  assert.deepEqual(after,b);
});
test('sample board outcomes are reproducible and playable with no data from another board',()=>{
  const day=new Date(2026,10,20), b=sampleBoard(day), other=sampleBoard(day);
  const a=readMetrics(sql,bytes(b),b.id,'All'), c=readMetrics(sql,bytes(other),other.id,'All');
  assert.deepEqual(a.byCategory,c.byCategory); assert.deepEqual(a.rounds,c.rounds);
  assert.equal(a.days.length,30);assert.equal(a.rounds.length,38);assert.ok(b.cells.every(g.isTask));
  assert.equal(a.total,75);
  const originals=b.daily.slots.filter(t=>t?.title==='Write my paper');
  assert.equal(originals.length,1);
  const copies=b.cells.filter(t=>t.title==='Write my paper');
  assert.equal(copies.length,3);
  assert.ok(copies.every(t=>t.source===originals[0].source));
  assert.equal(new Set(copies.map(t=>t.placement)).size,3);
  const tickets=b.cells.map(t=>b.weights[t.priority]);
  assert.equal(100*copies.length*b.weights.Standard/tickets.reduce((x,y)=>x+y,0),37.5);
  const occupied=new Set(), started=new Set(), mustSlots=new Set();
  for(const event of b.events){
    if(event.round && !started.has(event.round)){
      assert.equal(occupied.size,9,'Every simulated round must start full');
      started.add(event.round);
    }
    if(event.kind==='placed'){
      occupied.add(event.data.square);
      if(event.data.priority==='X') mustSlots.add(event.data.square);
    }
    if(event.kind==='completed') occupied.delete(event.data.square);
  }
  assert.equal(started.size,b.rounds.length);
  assert.ok(mustSlots.size>1,'Must-do examples should appear in different squares');
});

test('saved sample upgrades once, keeps the old round, and respects a personal default',()=>{
  for(const personalDefault of [false,true]){
    const old=g.createBoard('Earlier sample'), personal=g.createBoard('Personal');
    old.sample=true;
    old.daily.slots[0]=task('Keep this');
    g.place(old,'daily',0,0); g.start(old);
    const state={boards:[old,personal],defaultId:personalDefault?personal.id:old.id};
    assert.ok(updateSavedSample(state));
    const full=state.boards[2];
    assert.equal(state.defaultId,personalDefault?personal.id:full.id);
    assert.ok(full.cells.every(g.isTask));
    assert.ok(g.active(old));
    assert.equal(old.cells[0].title,'Keep this');
    assert.equal(updateSavedSample(state),false);
    g.deleteBoard(state,full.id);
    assert.equal(updateSavedSample(state),false);
    assert.equal(state.boards.length,2);
  }
});

test('one-off examples stay in the library until placed and only fill available slots on upgrade',()=>{
  const b=sampleBoard();
  const examples=b.temporary.slots.filter(Boolean);
  assert.deepEqual(examples.map(t=>t.title),['Return a library book','Book a dentist appointment','Email my draft to my advisor']);
  const ids=new Set(examples.map(t=>t.source));
  assert.equal(b.events.filter(e=>ids.has(e.data.source)&&e.kind==='created').length,3);
  assert.equal(b.events.filter(e=>ids.has(e.data.source)&&e.kind==='placed').length,0);
  b.sampleVersion=4;
  b.temporary.slots.fill(null);
  b.temporary.slots[0]={...examples[0],title:'My own task'};
  const personal=g.createBoard('Personal');
  const state={boards:[personal,b],defaultId:personal.id};
  g.start(b);
  const round=g.active(b).id, grid=structuredClone(b.cells);
  assert.ok(updateSavedSample(state));
  assert.equal(state.boards.length,2);
  assert.equal(state.defaultId,personal.id);
  assert.equal(b.temporary.slots[0].title,'My own task');
  assert.equal(b.temporary.slots.filter(Boolean).length,4);
  assert.ok(personal.temporary.slots.every(t=>t===null));
  assert.equal(g.active(b).id,round);
  assert.deepEqual(b.cells,grid);
  g.removeFromBoard(b,0);
  g.place(b,'temporary',1,0);
  assert.equal(b.cells[0].title,'Return a library book');
  assert.equal(b.temporary.slots[1],null);
  assert.equal(updateSavedSample(state),false);
});
