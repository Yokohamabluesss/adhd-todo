import type { SqlJsStatic, Database } from 'sql.js';
import { boardCategories, check, NOTE_IMAGE_LIMIT, DEFAULT_DAY_START, defaultWeights, isTask, MAX_SIZE, roundDay, validDayStart, validWeights } from './rules.ts';
import type { Workspace, Board, Task, Library, Round, Completion, StepGrid } from './rules.ts';
import { metricViews } from './metrics.ts';
import { activityViews } from './activity-metrics.ts';
import type { BoardEvent } from './rules.ts';

const SAVE_VERSION = 3;
// Older apps reject a single-board transfer instead of offering to replace all boards.
const BOARD_TRANSFER_VERSION = 4;
export class UnsupportedSave extends Error {}

// All installations exchange the same versioned SQLite schema. Grid snapshots keep
// square positions, while rounds and completion events remain directly queryable.
export function encode(SQL: SqlJsStatic, state: Workspace, scope: 'workspace' | 'board' = 'workspace'): Uint8Array {
  const singleBoard = scope === 'board';
  check(!singleBoard || state.boards.length === 1, 'A board download must contain exactly one board.');
  const db = new SQL.Database();
  try {
    db.run(`PRAGMA user_version=${singleBoard ? BOARD_TRANSFER_VERSION : SAVE_VERSION};
      CREATE TABLE settings(default_board TEXT NOT NULL);
      CREATE TABLE boards(id TEXT PRIMARY KEY, name TEXT, balance INTEGER, layout TEXT);
      CREATE TABLE rounds(id TEXT PRIMARY KEY, board TEXT, day TEXT, start INTEGER, end INTEGER, success INTEGER);
      CREATE TABLE completions(board TEXT, round TEXT, source TEXT, title TEXT, minutes INTEGER, at INTEGER, points INTEGER, attributes TEXT);
      CREATE INDEX completion_round ON completions(board,round);
      CREATE TABLE board_events(board TEXT, kind TEXT, at INTEGER, day TEXT, round TEXT, data TEXT);
      CREATE INDEX event_round ON board_events(board,round,kind);
      ${metricViews}
      ${activityViews}`);
    db.run('INSERT INTO settings VALUES (?)', [state.defaultId]);
    for (const b of state.boards) {
      const { id, name, balance, rounds, history, events, ...layout } = b;
      db.run('INSERT INTO boards VALUES (?,?,?,?)', [id, name, balance, JSON.stringify(layout)]);
      for (const r of rounds) db.run('INSERT INTO rounds VALUES (?,?,?,?,?,?)', [r.id, id, r.day, r.start, r.end, Number(r.success)]);
      for (const e of events) db.run('INSERT INTO board_events VALUES (?,?,?,?,?,?)',[id,e.kind,e.at,e.day,e.round,JSON.stringify(e.data)]);
      for (const e of history) {
        const { round, source, title, minutes, at, points, ...attributes } = e;
        db.run('INSERT INTO completions VALUES (?,?,?,?,?,?,?,?)', [id, round, source, title, minutes, at, points, JSON.stringify(attributes)]);
      }
    }
    return db.export();
  } finally { db.close(); }
}
const validSize = (v: number) => Number.isInteger(v) && v >= 2 && v <= MAX_SIZE;
const uint = (v: number) => Number.isSafeInteger(v) && v >= 0;
const string = (v: unknown) => typeof v === 'string';
const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const dayKey = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function validSteps(grid: StepGrid): boolean {
  return !!grid && validSize(grid.size) && Array.isArray(grid.slots) && grid.slots.length === grid.size ** 2
    && grid.slots.every(s => s === null || (s && filled(s.title) && typeof s.done === 'boolean'
      && (s.doneDay === undefined || dayKey(s.doneDay)) && (s.steps === undefined || validSteps(s.steps))));
}
function checkNotes(b:Board) {
  const images=b.noteImages;
  check(images===undefined || (images!==null && typeof images==='object' && !Array.isArray(images) &&
    Object.values(images).every(data=>typeof data==='string' && data.length<=NOTE_IMAGE_LIMIT &&
      /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(data))), 'Invalid note images.');
  for(const item of [...b.cells,...b.daily.slots,...b.temporary.slots,...b.history]) {
    if(!isTask(item) || item.note===undefined) continue;
    const n=item.note;
    check(n && typeof n==='object' && typeof n.text==='string' &&
      (n.image===undefined || (typeof n.image==='string' && images && Object.hasOwn(images,n.image))), 'Invalid task note.');
  }
}
function validTask(t: Task) {
  return t && filled(t.source) && filled(t.title) && ['daily', 'temporary'].includes(t.library)
    && ['X', 'Standard', 'Low'].includes(t.priority) && uint(t.minutes) && string(t.category)
    && string(t.due) && (!t.due || /^\d{4}-\d{2}-\d{2}$/.test(t.due))
    && (t.steps === undefined || validSteps(t.steps));
}
function rows(db: Database, query: string) { return db.exec(query)[0]?.values ?? []; }
export function decode(SQL: SqlJsStatic, bytes: Uint8Array): Workspace {
  return readSave(SQL,bytes).state;
}
export function readSave(SQL: SqlJsStatic, bytes: Uint8Array) {
  const db = new SQL.Database(bytes);
  try {
    const version = rows(db, 'PRAGMA user_version')[0]?.[0];
    // Upgrade at the next commit/export. Earlier saves have no event history.
    const singleBoard = version === BOARD_TRANSFER_VERSION;
    if (version !== 1 && version !== 2 && version !== SAVE_VERSION && !singleBoard) {
      throw new UnsupportedSave('Unsupported save version. Files from a newer release need a newer app.');
    }
    const defaultId = rows(db, 'SELECT default_board FROM settings')[0]?.[0];
    const boards = new Map<string, Board>();
    for (const [id, name, balance, json] of rows(db, 'SELECT id,name,balance,layout FROM boards ORDER BY rowid')) {
      const b: Board = { dayStart: DEFAULT_DAY_START, weights: {...defaultWeights}, ...JSON.parse(String(json)), id, name, balance, rounds: [], history: [], events:[] };
      check(b.sample === undefined || typeof b.sample === 'boolean','Invalid sample board marker.');
      check(b.categories === undefined || (Array.isArray(b.categories) && b.categories.every(filled)),'Invalid categories.');
      check(validDayStart(b.dayStart), 'Invalid day start time.');
      check(validWeights(b.weights), 'Invalid priority weights.');
      check(b.shuffleSpending === undefined || (b.shuffleSpending && typeof b.shuffleSpending === 'object'
        && !Array.isArray(b.shuffleSpending) && Object.entries(b.shuffleSpending).every(([d,n]) => dayKey(d) && uint(n))), 'Invalid shuffle spending.');
      check(filled(id) && filled(name) && uint(b.balance) && validSize(b.size) && typeof b.grouped === 'boolean', 'Invalid board.');
      check(Array.isArray(b.rows) && b.rows.length === b.size && b.rows.every(string), 'Invalid row labels.');
      check(Array.isArray(b.cells) && b.cells.length === b.size ** 2 && b.cells.every(c => c === null ||
        (isTask(c) ? validTask(c) && !('done' in c) : c.done === true && (c.entry === undefined || uint(c.entry)))), 'Invalid board squares.');
      for (const k of ['daily', 'temporary'] as Library[]) {
        const shelf = b[k];
        check(shelf && validSize(shelf.size) && Array.isArray(shelf.slots) && shelf.slots.length === shelf.size ** 2 &&
          shelf.slots.every(t => t === null || (validTask(t) && t.library === k)), 'Invalid task library.');
      }
      check(!boards.has(b.id), 'Duplicate board.');
      boards.set(b.id, b);
    }
    for (const [id, board, day, start, end, success] of rows(db, 'SELECT id,board,day,start,end,success FROM rounds ORDER BY rowid')) {
      const b = boards.get(String(board));
      check(b && filled(id) && /^\d{4}-\d{2}-\d{2}$/.test(String(day)) && uint(Number(start)) &&
        (end === null || uint(Number(end))) && (success === 0 || success === 1), 'Invalid round.');
      check(end !== null || !b.rounds.some(r => r.end === null), 'Multiple open rounds.');
      b.rounds.push({ id, day, start, end, success: !!success } as Round);
    }
    for (const [board, round, source, title, minutes, at, points, json] of rows(db, 'SELECT board,round,source,title,minutes,at,points,attributes FROM completions ORDER BY rowid')) {
      const b = boards.get(String(board));
      const e: Completion = { ...JSON.parse(String(json)), round, source, title, minutes, at, points };
      check(b && b.rounds.some(r => r.id === round) && validTask(e) && uint(e.at) && uint(e.points), 'Invalid completion.');
      check(e.activityDay === undefined || dayKey(e.activityDay),'Invalid completion day.');
      e.activityDay ??= roundDay(new Date(e.at),b.dayStart);
      b.history.push(e);
    }
    if (version === SAVE_VERSION || singleBoard) {
      const roundIds = new Map([...boards].map(([id,b])=>[id,new Set(b.rounds.map(r=>r.id))]));
      for (const [board,kind,at,day,round,json] of rows(db,'SELECT board,kind,at,day,round,data FROM board_events ORDER BY rowid')) {
        const b = boards.get(String(board)), data = JSON.parse(String(json));
        check(b && ['created','placed','removed','drawn','completed','shuffled','ended'].includes(String(kind)) &&
          uint(Number(at)) && dayKey(day) && (round === null || roundIds.get(b.id)!.has(String(round))) &&
          data && typeof data==='object' && !Array.isArray(data) && Object.values(data).every(v=>v===null || typeof v==='string' || typeof v==='number'),'Invalid board event.');
        b.events.push({kind,at,day,round,data} as BoardEvent);
      }
    }
    check(typeof defaultId === 'string' && boards.has(defaultId), 'Missing default board.');
    for (const b of boards.values()) {
      checkNotes(b);
      const names = boardCategories(b);
      if (names.length) b.categories = names;
    }
    check(!singleBoard || boards.size === 1, 'Invalid single-board save.');
    return { state: { boards: [...boards.values()], defaultId }, singleBoard };
  } finally { db.close(); }
}
