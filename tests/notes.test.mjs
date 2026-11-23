import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import * as g from '../src/rules.ts';
import {encode,decode} from '../src/archive.ts';

test('note images survive round completion, reset and SQLite transfer until their last reference is removed',async()=>{
  const sql=await initSqlJs();
  const b=g.createBoard('Notes'),state=g.workspace(b);
  b.noteImages={photo:'data:image/png;base64,iVBORw0KGgo='};
  b.daily.slots[0]={source:g.newId(),title:'Read',priority:'Standard',library:'daily',
    minutes:10,due:'',category:'',note:{text:'Template',image:'photo'}};
  g.place(b,'daily',0,0);g.place(b,'daily',0,1);
  b.cells[0].note.text='First square';
  assert.equal(b.cells[1].note.text,'Template');
  g.start(b);g.complete(b,0);
  delete b.daily.slots[0].note;delete b.cells[1].note;
  g.discardUnusedImages(b);
  const saved=decode(sql,encode(sql,state)).boards[0];
  assert.equal(saved.history[0].note.text,'First square');
  assert.deepEqual(saved.noteImages,b.noteImages);
  g.resetBoard(saved,'all');assert.equal(saved.cells[0].note.image,'photo');
  delete saved.cells[0].note;g.discardUnusedImages(saved);assert.equal(saved.noteImages,undefined);
  delete b.noteImages;
  assert.throws(()=>decode(sql,encode(sql,state)),/Invalid task note/);
});
