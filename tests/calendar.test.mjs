import { test } from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,calendarGrid} from '../src/activity-calendar.ts';
import {createBoard,start,complete,finish} from '../src/rules.ts';

test('calendar keeps cross-day completions on their confirmed board day, including leap day',()=>{
  const b=createBoard('Study');
  b.dayStart='06:30';
  b.cells[0]={source:'x',library:'daily',priority:'Standard',category:'',title:'Read',due:'',minutes:10};
  start(b,new Date(2024,1,29,6,29));
  complete(b,0,+new Date(2024,1,29,6,30));finish(b,+new Date(2024,1,29,6,31));
  b.dayStart='08:00';
  const days=calendarDays(b,[{day:'2024-02-28',n:1,status:'Success'}]);
  assert.deepEqual(days.get('2024-02-28'),{completed:0,starts:1,status:'Success',included:true});
  assert.deepEqual(days.get('2024-02-29'),{completed:1,starts:0,status:'',included:true});
  const grid=calendarGrid(days,2024,'2025-01-02');
  assert.equal((grid.match(/class="cal-day"/g)??[]).length,366);
  assert.match(grid,/data-level="started" data-day="2024-02-28"/);
  assert.match(grid,/2024-02-29 · 1 task completed · 0 rounds started/);
  assert.match(grid,/2024-03-01 · 0 tasks completed · 0 rounds started/);
  const filtered=calendarGrid(calendarDays(b,[]),2024,'2024-02-29');
  assert.match(filtered,/2024-02-29 · Activity outside the selected day filter/);
  assert.doesNotMatch(filtered,/data-day="2024-03-01"/);
});
