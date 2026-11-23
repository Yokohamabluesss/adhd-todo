import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import * as g from '../src/rules.ts';
import { encode, decode, readSave } from '../src/archive.ts';

const makeTask = (title = 'Lesson', priority = 'Standard', library = 'daily') => ({
  source: crypto.randomUUID(), title, priority, library, minutes: 0, due: '', category: ''
});
function withTasks(indices, size = 3) {
  const b = g.createBoard('Study');
  g.resizeBoard(b, size);
  for (const i of indices) b.cells[i] = makeTask('Task ' + i);
  g.start(b, new Date(2026,10,18,20));
  return b;
}
test('deleting the default board preserves another board with the same name and its open round', async () => {
  const remaining = withTasks([0,1]), removed = g.createBoard(remaining.name);
  const state = {boards:[removed,remaining], defaultId:removed.id};
  g.complete(remaining,0);
  g.deleteBoard(state,removed.id);
  const sql = await initSqlJs();
  assert.deepEqual(decode(sql,encode(sql,state)),{boards:[remaining],defaultId:remaining.id});
});
test('two tasks clear a sparse board, never an empty square Bingo', () => {
  const b = withTasks([0, 1]);
  g.complete(b,0);
  assert.equal(g.active(b).success,false);
  g.complete(b,1);
  assert.deepEqual(g.lines(b),[]);
  assert.equal(g.active(b).success,true);
  assert.throws(() => g.complete(b,1));
  assert.equal(b.balance,2);
});
test('single-board transfers preserve rounds, history and events across repeated imports', async () => {
  const sql = await initSqlJs();
  const b = withTasks([0,1]);
  g.complete(b,0);
  const state = g.workspace(b);
  assert.equal(readSave(sql,encode(sql,state)).singleBoard,false);
  const transfer = readSave(sql,encode(sql,state,'board'));
  assert.ok(transfer.singleBoard);
  const incoming = transfer.state.boards[0];
  g.addImportedBoard(state,incoming);
  g.addImportedBoard(state,incoming);
  const restored = decode(sql,encode(sql,state));
  const invalidTransfer = new sql.Database(encode(sql,state));
  try {
    invalidTransfer.run('PRAGMA user_version=4');
    assert.throws(() => readSave(sql,invalidTransfer.export()),/Invalid single-board save/);
  } finally { invalidTransfer.close(); }
  assert.equal(restored.defaultId,b.id);
  assert.deepEqual(restored.boards.map(b => b.name),['Study','Study (2)','Study (3)']);
  assert.equal(new Set(restored.boards.map(b => b.id)).size,3);
  assert.equal(new Set(restored.boards.map(b => g.active(b).id)).size,3);
  for (const copy of restored.boards) {
    assert.equal(copy.history[0].round,g.active(copy).id);
    assert.equal(copy.events.find(e => e.kind==='completed').round,g.active(copy).id);
  }
  g.complete(restored.boards[1],1);
  assert.ok(g.isTask(restored.boards[0].cells[1]));
});
test('discarding placed tasks keeps both shelves, other copies and completion records intact', () => {
  const b = g.createBoard('Discard');
  b.daily.slots[0] = makeTask();
  b.temporary.slots[0] = makeTask('One-off','X','temporary');
  g.place(b,'daily',0,0); g.place(b,'daily',0,1); g.place(b,'temporary',0,2);
  g.start(b);
  b.temporary.slots.fill(makeTask('Other','Standard','temporary'));
  const shelves = structuredClone([b.daily,b.temporary]);
  for (const i of [0,2]) g.deletePlacedTask(b,i);
  assert.deepEqual([b.daily,b.temporary],shelves);
  assert.ok(g.isTask(b.cells[1]));
  assert.deepEqual([b.cells[0],b.cells[2],b.history.length,b.balance,g.lines(b)], [null,null,0,0,[]]);
  assert.equal(b.events.filter(e=>e.kind==='removed').length,2);
  g.deletePlacedTask(b,1);
  assert.equal(g.active(b).success,false);
  assert.throws(()=>g.deletePlacedTask(b,1));
});
test('row, column and both main diagonals qualify; any remaining X gates success', () => {
  for (const line of [[0,1,2],[0,3,6],[0,4,8],[2,4,6]]) {
    const b = withTasks([...line,7]);
    b.cells[7].priority = 'X';
    for (const i of line) g.complete(b,i);
    assert.deepEqual(g.lines(b),[line]);
    assert.equal(g.active(b).success,false);
    assert.deepEqual(g.candidates(b),[7]);
    g.complete(b,7);
    assert.ok(g.active(b).success);
  }
});
test('a broken line before the final X does not unlock success', () => {
  const b = withTasks([0,1,2,4,8]);
  b.cells[8].priority = 'X';
  for (const i of [0,1,2]) g.complete(b,i);
  g.shuffle(b,() => 0.25);
  assert.equal(g.lines(b).length,0);
  g.complete(b,b.cells.findIndex(c => g.isTask(c) && c.priority === 'X'));
  assert.equal(g.active(b).success, g.lines(b).length > 0);
});
test('shuffle moves marks, charges once, retains success and unfinished tasks', () => {
  const b = withTasks([0,1,2,8]);
  b.cells[0].minutes = 60;
  for (const i of [0,1,2]) g.complete(b,i);
  assert.equal(b.balance,4);
  g.shuffle(b,() => .25);
  assert.equal(b.balance,1);
  assert.ok(g.active(b).success);
  assert.throws(() => g.shuffle(b));
  const pos = b.cells.findIndex(g.isTask);
  g.finish(b);
  assert.equal(g.active(b),undefined);
  assert.equal(b.cells[pos].title,'Task 8');
  assert.equal(g.shuffleCost(b),0);
  g.start(b);
  assert.equal(b.balance,1);
});
test('grouped shuffle stays inside each row and an identical board costs nothing', () => {
  const b = withTasks([0,3,6]);
  b.grouped = true;
  g.complete(b,0);
  g.shuffle(b,() => 0);
  for (let row = 0; row < 3; row++) {
    const entries = b.cells.slice(row*3,row*3+3).filter(Boolean);
    assert.equal(entries.length,1);
    if (row) assert.equal(entries[0].title,'Task '+row*3);
    else assert.ok(g.isDone(entries[0]));
  }
  const full = withTasks([0,1,2,3],2);
  for (const i of [0,1,2,3]) g.complete(full,i);
  assert.throws(() => g.shuffle(full));
  assert.equal(full.balance,4);
});
test('weighted draw gives Standard two tickets and X exclusive access', () => {
  const b = withTasks([3,7]); b.cells[7].priority = 'Low';
  assert.deepEqual([0,.34,.67].map(value => g.draw(b,() => value)),[3,3,7]);
  b.cells[7].priority = 'X';
  assert.equal(g.draw(b,() => 0),7);
});
test('custom odds apply per square, survive a save, and give way to Must-do', async () => {
  const b = withTasks([0,1,2]);
  b.cells[1].priority = b.cells[2].priority = 'Low';
  b.weights = { Standard: 1, Low: 3 };
  const outcomes = Array.from({length:7},(_,i) => g.draw(b,() => (i+.5)/7));
  assert.deepEqual(outcomes,[0,1,1,1,2,2,2]);
  const sql = await initSqlJs();
  const data = {boards:[b],defaultId:b.id};
  assert.deepEqual(decode(sql,encode(sql,data)).boards[0].weights,b.weights);
  b.cells[0].priority = b.cells[2].priority = 'X';
  assert.deepEqual([.2,.8].map(p => g.draw(b,() => p)),[0,2]);
  for (const invalid of [0,-2,1.5,101]) assert.equal(g.validWeights({Standard:invalid,Low:1}),false);
});
test('library copies, instance properties and snapshots stay independent', () => {
  const b = g.createBoard('Reading');
  b.daily.slots[0] = makeTask();
  g.place(b,'daily',0,0); g.place(b,'daily',0,1);
  g.start(b); b.cells[0].minutes = 59; b.cells[0].priority = 'X';
  g.complete(b,0);
  b.daily.slots[0].title = 'New title';
  assert.equal(b.history[0].title,'Lesson');
  assert.equal(b.history[0].points,1);
  assert.equal(b.cells[1].priority,'Standard');
  assert.equal(b.cells[1].source,b.history[0].source);
  assert.throws(() => g.place(b,'daily',0,0));
});

test('custom start time applies at the minute and keeps open and past rounds on their original day', async () => {
  const b = g.createBoard('Late mornings');
  const at = (h,m) => new Date(2026,0,1,h,m);
  for (const t of ['00:00','06:30','23:59']) assert.ok(g.validDayStart(t));
  for (const t of ['24:00','5:00','05:60','',null]) assert.equal(g.validDayStart(t),false);
  assert.equal(g.roundDay(at(0,0),'00:00'),'2026-01-01');
  assert.equal(g.roundDay(at(23,58),'23:59'),'2025-12-31');
  assert.equal(g.roundDay(at(23,59),'23:59'),'2026-01-01');
  b.cells[0]=makeTask('First'); b.cells[1]=makeTask('Second');
  g.start(b,at(5,0)); g.complete(b,0,+at(5,5));
  b.dayStart='06:30';
  g.resetBoard(b,'today',at(6,29));
  assert.equal(g.active(b).day,'2026-01-01');
  g.finish(b,+at(6,29));
  g.start(b,at(6,29)); assert.equal(g.active(b).day,'2025-12-31');
  g.resetBoard(b,'today',at(6,29)); assert.equal(b.rounds.length,1);
  g.start(b,at(6,30)); assert.equal(g.active(b).day,'2026-01-01');
  const sql=await initSqlJs(), other=g.createBoard('Other');
  const saved=decode(sql,encode(sql,{boards:[b,other],defaultId:b.id}));
  assert.deepEqual(saved.boards.map(board=>board.dayStart),['06:30','04:00']);
  assert.equal(saved.boards[0].history.length,1);
});
test('one-off return preserves the task; withdrawal alone cannot clear the round', () => {
  const b = g.createBoard('One-offs');
  b.temporary.slots[0] = makeTask('Pay bill','X','temporary');
  g.place(b,'temporary',0,2);
  assert.equal(b.temporary.slots[0],null);
  g.start(b);
  g.removeFromBoard(b,2);
  assert.equal(b.temporary.slots[0].title,'Pay bill');
  assert.equal(g.active(b).success,false);
});
test('returning everyday copies preserves their template and can restore a deleted original', () => {
  const b = g.createBoard('Everyday returns');
  const original = makeTask();
  b.daily.slots[0] = original;
  g.place(b,'daily',0,0);
  g.place(b,'daily',0,1);
  b.cells[0].title = 'Only on this square';
  g.removeFromBoard(b,0,{library:'daily',slot:2});
  assert.equal(b.cells[0],null);
  assert.deepEqual(b.daily.slots.filter(Boolean),[original]);
  b.daily.slots[0] = null;
  b.cells[1].note = {text:'Keep this reminder'};
  g.removeFromBoard(b,1,{library:'daily',slot:2});
  assert.deepEqual(b.daily.slots[2],{...original,note:{text:'Keep this reminder'}});
});
test('one-off drops reject wrong or full destinations before moving the task and recording its removal', () => {
  const b = g.createBoard('Return destinations');
  const task = makeTask('Deliver outline','X','temporary');
  b.temporary.slots[0] = task;
  g.place(b,'temporary',0,1);
  g.start(b);
  b.temporary.slots.fill(makeTask('Occupied','Low','temporary'));
  const before = structuredClone(b);
  for (const destination of [{library:'daily'},{library:'temporary',slot:3},{library:'temporary'}]) {
    assert.throws(()=>g.removeFromBoard(b,1,destination));
    assert.deepEqual(b,before);
  }
  b.temporary.slots[5] = null;
  g.removeFromBoard(b,1,{library:'temporary'});
  assert.deepEqual(b.temporary.slots[5],task);
  assert.equal(b.cells[1],null);
  assert.equal(b.events.at(-1).kind,'removed');
  assert.equal(b.balance,0);
  assert.equal(b.history.length,0);
});
test('active board size/positions are locked, shrinking preserves occupied coordinates', () => {
  const b = withTasks([8]);
  assert.throws(() => g.move(b,8,0));
  assert.throws(() => g.resizeBoard(b,2));
  g.finish(b);
  assert.throws(() => g.resizeBoard(b,2));
  g.move(b,8,0);
  g.resizeBoard(b,2);
  assert.equal(b.cells[0].title,'Task 8');
  assert.equal(b.cells.length,4);
});
test('days use local 04:00 and start date, including month boundaries', () => {
  assert.equal(g.roundDay(new Date(2026,0,1,3,59)), '2025-12-31');
  assert.equal(g.roundDay(new Date(2026,0,1,4,0)), '2026-01-01');
  const b = g.createBoard('Home'); b.cells[0] = makeTask();
  g.start(b,new Date(2026,10,19,3,59));
  g.finish(b,+new Date(2026,10,19,4,10));
  assert.deepEqual([...g.dayResults(b)],[['2026-11-18','Unfinished']]);
  g.start(b,new Date(2026,10,19,8));
  assert.equal(g.dayResults(b).get('2026-11-19'),'In progress');
  g.finish(b); g.start(b,new Date(2026,10,19,9)); g.complete(b,0);
  assert.equal(g.dayResults(b).get('2026-11-19'),'Success');
});
test('SQLite save restores multiple boards, open round, completion log and default', async () => {
  const sql = await initSqlJs();
  const b = withTasks([0,8]);
  b.cells[0].minutes=90; g.complete(b,0);
  const s = { boards:[g.createBoard('Home'),b], defaultId:b.id };
  const bytes = encode(sql,s);
  assert.equal(new TextDecoder().decode(bytes.slice(0,15)),'SQLite format 3');
  assert.deepEqual(decode(sql,bytes),s);
  assert.throws(() => decode(sql,new Uint8Array([1,2,3])));
  const db = new sql.Database(bytes);
  db.run('PRAGMA user_version=999');
  assert.throws(() => decode(sql,db.export()));
  db.close();
});

test('v1 progress survives export in the current format, including open round, points, library and must-do flags', async () => {
  const sql = await initSqlJs();
  const bytes = await readFile(new URL('./fixtures/v1-board.sqlite', import.meta.url));
  const s = decode(sql,bytes), b = s.boards[0];
  assert.deepEqual(b.weights,{Standard:2,Low:1});
  assert.equal(b.dayStart,'04:00');
  assert.equal(s.defaultId,b.id);
  assert.equal(b.balance,2);
  assert.equal(g.shuffleCost(b),1);
  assert.equal(g.active(b).day,'2026-11-19');
  assert.equal(b.history[0].title,'Read notes');
  assert.equal(b.daily.slots[0].title,'Read notes');
  assert.equal(g.priorityNames[b.cells[1].priority],'Must-do');
  assert.equal(b.cells[1].steps,undefined);
  b.cells[1].steps = {size:2,slots:[{title:'Draft',done:true},null,null,null]};
  assert.deepEqual(decode(sql,encode(sql,s)),s);
});
test('nested progress is independent of templates, parent points and main board success', () => {
  const b = g.createBoard('Steps');
  b.daily.slots[0] = {...makeTask(),steps:{size:2,slots:[{title:'Read',done:false},null,null,null]}};
  g.place(b,'daily',0,0); g.place(b,'daily',0,1); g.start(b);
  b.cells[0].steps.slots[0].done = true;
  assert.equal(b.cells[1].steps.slots[0].done,false);
  assert.equal(b.daily.slots[0].steps.slots[0].done,false);
  assert.ok(g.isTask(b.cells[0]));
  assert.equal(b.balance,0); assert.equal(b.history.length,0);
  assert.equal(g.active(b).success,false); assert.deepEqual(g.lines(b),[]);
  g.complete(b,1);
  assert.equal(b.balance,1);
  assert.equal(b.history[0].steps.slots[0].done,false);
});

test('today reset follows round start at 4 am, restores shuffled tasks and reverses only that day’s points', async () => {
  const b = g.createBoard('Two days');
  const prior = new Date(2026,10,20,3,59), today = new Date(2026,10,20,4);
  b.cells[0] = {...makeTask('Yesterday'),minutes:90};
  g.start(b,prior); g.complete(b,0,+today);
  const openYesterday = structuredClone(b);
  g.resetBoard(b,'today',today);
  assert.deepEqual(b,openYesterday);
  g.finish(b,+today);
  b.cells[0] = makeTask('A'); b.cells[1] = makeTask('B','X','temporary');
  b.cells[1].steps = {size:2,slots:[
    {title:'Yesterday',done:true,doneDay:'2026-11-19'},
    {title:'Today',done:true,doneDay:'2026-11-20'},null,null]};
  g.start(b,today); g.complete(b,1,+today); g.complete(b,0,+today);
  g.shuffle(b,()=>0);
  const a = b.cells.findIndex(c=>c?.entry === 1), z = b.cells.findIndex(c=>c?.entry === 0);
  const sql = await initSqlJs();
  const [restored] = decode(sql,encode(sql,{boards:[b],defaultId:b.id})).boards;
  g.resetBoard(restored,'today',today);
  assert.equal(restored.rounds.length,1); assert.equal(restored.history[0].title,'Yesterday');
  assert.equal(restored.history.length,1); assert.equal(restored.balance,3);
  assert.equal(restored.cells[a].title,'A'); assert.equal(restored.cells[z].title,'B');
  assert.deepEqual(restored.cells[z].steps.slots.slice(0,2).map(s=>s.done),[true,false]);
  const again=structuredClone(restored); g.resetBoard(restored,'today',today);
  assert.deepEqual(restored,again);
});
test('all progress restores legacy squares and steps, while clearing the grid keeps records and libraries', async () => {
  const sql = await initSqlJs();
  const {boards:[b]} = decode(sql,await readFile(new URL('./fixtures/v1-board.sqlite',import.meta.url)));
  b.cells[1].steps = {size:2,slots:[{title:'Undated',done:true},null,null,null]};
  const libs = structuredClone([b.daily,b.temporary]);
  const clear = structuredClone(b);
  g.resetBoard(clear,'grid');
  assert.ok(clear.cells.every(c=>c===null)); assert.equal(g.active(clear),undefined);
  assert.equal(clear.rounds[0].success,b.rounds[0].success);
  assert.deepEqual(clear.history,b.history); assert.equal(clear.balance,b.balance);
  g.resetBoard(b,'all');
  assert.deepEqual([b.rounds.length,b.history.length,b.balance],[0,0,0]);
  assert.ok(b.cells.some(c=>c?.title==='Read notes'));
  assert.equal(b.cells[1].steps.slots[0].done,false);
  for(const board of [b,clear]) assert.deepEqual([board.daily,board.temporary],libs);
});
