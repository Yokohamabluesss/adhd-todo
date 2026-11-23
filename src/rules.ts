export type Priority = 'Standard' | 'Low' | 'X';
export type Library = 'daily' | 'temporary';
export interface Step { title: string; done: boolean; doneDay?: string; steps?: StepGrid }
export interface StepGrid { size: number; slots: (Step | null)[] }
export const priorityNames: Record<Priority, string> = { X: 'Must-do', Standard: 'Standard', Low: 'Low' };
export interface Task {
  note?: { text:string; image?:string };
  placement?: string;
  source: string;
  library: Library;
  title: string;
  priority: Priority;
  minutes: number;
  due: string;
  category: string;
  steps?: StepGrid;
}
export interface Done { done: true; entry?: number }
export type Cell = Task | Done | null;
export interface Shelf { size: number; slots: (Task | null)[] }
export interface Round { id: string; day: string; start: number; end: number | null; success: boolean }
export interface Completion extends Task { round: string; at: number; points: number; activityDay?: string }
export interface Board {
  noteImages?: Record<string,string>;
  categories?: string[];
  sample?: boolean;
  sampleVersion?: number;
  sampleUpdated?: boolean;
  events: BoardEvent[];
  dayStart: string;
  weights: DrawWeights;
  id: string; name: string; size: number; cells: Cell[]; rows: string[]; grouped: boolean;
  daily: Shelf; temporary: Shelf; balance: number; rounds: Round[]; history: Completion[];
  shuffleSpending?: Record<string, number>;
}
export function discardUnusedImages(b:Board) {
  if(!b.noteImages) return;
  const used=new Set([...b.cells,...b.daily.slots,...b.temporary.slots,...b.history]
    .flatMap(t=>isTask(t) && t.note?.image ? [t.note.image]:[]));
  for(const key of Object.keys(b.noteImages)) if(!used.has(key)) delete b.noteImages[key];
  if(!Object.keys(b.noteImages).length) delete b.noteImages;
}
export const NOTE_IMAGE_LIMIT = 600_000; // Maximum length of a resized image data URL.
export type EventKind = 'created' | 'placed' | 'removed' | 'drawn' | 'completed' | 'shuffled' | 'ended';
export interface BoardEvent {
  kind: EventKind; at: number; day: string; round: string | null;
  data: Record<string,string | number | null>;
}
export function recordEvent(b: Board,kind: EventKind,data: BoardEvent['data'],at = Date.now()) {
  const r = active(b);
  b.events.push({kind,at,round:r?.id ?? null,day:r?.day ?? roundDay(new Date(at),b.dayStart),data});
}
function taskData(t: Task) {
  return {source:t.source,placement:t.placement ?? null,library:t.library,category:t.category,priority:t.priority};
}
export interface Workspace { boards: Board[]; defaultId: string }
export const MAX_SIZE = 12;
export const DEFAULT_DAY_START = '04:00';
export const validDayStart = (time: unknown): time is string =>
  typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
export type DrawWeights = { Standard: number; Low: number };
export const defaultWeights: Readonly<DrawWeights> = { Standard: 2, Low: 1 };
export function validWeights(w: DrawWeights): boolean {
  return !!w && [w.Standard,w.Low].every(n => Number.isInteger(n) && n >= 1 && n <= 100);
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export const isTask = (c: Cell | undefined): c is Task => !!c && 'source' in c;
export const isDone = (c: Cell): c is Done => !!c && 'done' in c;
export function boardCategories(b: Board) {
  const names = new Set(b.categories);
  for (const task of [...b.daily.slots,...b.temporary.slots,...b.cells,...b.history]) {
    if (isTask(task) && task.category) names.add(task.category);
  }
  for (const e of b.events) {
    if (typeof e.data.category === 'string' && e.data.category) names.add(e.data.category);
  }
  return [...names].sort((a,b) => a.localeCompare(b));
}
export const active = (b: Board) => b.rounds.find(r => r.end === null);
// Plain HTTP on home Wi-Fi may not expose randomUUID, but getRandomValues works there.
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function createBoard(name: string): Board {
  check(name.trim(), 'Give the board a name.');
  const shelf = (): Shelf => ({ size: 3, slots: Array(9).fill(null) });
  return { id: newId(), name: name.trim(), events:[], dayStart: DEFAULT_DAY_START, weights: {...defaultWeights}, size: 3, cells: Array(9).fill(null),
    grouped: false, rows: ['', '', ''], daily: shelf(), temporary: shelf(), balance: 0, rounds: [], history: [] };
}
export function workspace(b: Board = createBoard('My board')): Workspace {
  return { boards: [b], defaultId: b.id };
}
export function addImportedBoard(state: Workspace, original: Board) {
  const copy = structuredClone(original);
  if (state.boards.some(b => b.id === copy.id)) copy.id = newId();
  const names = new Set(state.boards.map(b => b.name));
  for (let n = 2; names.has(copy.name); n++) copy.name = `${original.name} (${n})`;
  // Round IDs are primary keys across the entire SQLite file.
  const existing = new Set(state.boards.flatMap(b => b.rounds.map(r => r.id)));
  const changed = new Map<string,string>();
  for (const round of copy.rounds) {
    if (existing.has(round.id)) {
      const id = newId();
      changed.set(round.id,id);
      round.id = id;
    }
  }
  for (const record of [...copy.history,...copy.events]) {
    if (record.round !== null) record.round = changed.get(record.round) ?? record.round;
  }
  state.boards.push(copy);
  return copy.id;
}
export function deleteBoard(state: Workspace,id: string) {
  const index = state.boards.findIndex(b => b.id === id);
  check(index >= 0,'This board is no longer available.');
  state.boards.splice(index,1);
  if (!state.boards.length) state.boards.push(createBoard('My board'));
  if (state.defaultId === id) state.defaultId = state.boards[0].id;
}
export function dateKey(date: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}
export function roundDay(now: Date, dayStart = DEFAULT_DAY_START): string {
  const day = new Date(now);
  const [hour,minute] = dayStart.split(':').map(Number);
  const boundary = new Date(now);
  boundary.setHours(hour,minute,0,0);
  if (now < boundary) day.setDate(day.getDate() - 1);
  return dateKey(day);
}
export function start(b: Board, now = new Date()) {
  check(!active(b), 'A round is already open.');
  check(b.cells.some(isTask), 'Place at least one task before starting.');
  b.rounds.push({ id: newId(), day: roundDay(now,b.dayStart), start: +now, end: null, success: false });
}
function axes(b: Board): number[][] {
  const axes: number[][] = [];
  const indexes = Array.from({ length: b.size }, (_, i) => i);
  for (const i of indexes) {
    axes.push(indexes.map(j => i * b.size + j), indexes.map(j => j * b.size + i));
  }
  axes.push(indexes.map(i => i * b.size + i), indexes.map(i => (i + 1) * (b.size - 1)));
  return axes;
}
export function lines(b: Board): number[][] {
  return axes(b).filter(line => line.every(i => isDone(b.cells[i])));
}
export const hasX = (b: Board) => b.cells.some(c => isTask(c) && c.priority === 'X');
export function evaluate(b: Board, justCompleted = false) {
  const r = active(b);
  if (!r || r.success) return;
  if ((justCompleted && !b.cells.some(isTask)) || (lines(b).length > 0 && !hasX(b))) r.success = true;
}
export function complete(b: Board, index: number, at = Date.now()) {
  const r = active(b);
  const task = b.cells[index];
  check(r && isTask(task), 'Select an unfinished task in an active round.');
  const points = Math.max(1, Math.floor(task.minutes / 30));
  task.placement ??= newId();
  b.history.push({ ...task, points, at, round: r.id, activityDay:roundDay(new Date(at),b.dayStart) });
  b.cells[index] = { done: true, entry: shuffleCost(b) };
  b.balance += points;
  recordEvent(b,'completed',{...taskData(task),square:index,size:b.size,lines:lineNames(b)},at);
  evaluate(b, true);
}
export function finish(b: Board, now = Date.now()) {
  const r = active(b);
  check(r, 'Start a round first.');
  recordEvent(b,'ended',{size:b.size,remaining:distanceToSuccess(b),completed:shuffleCost(b)},now);
  r.end = now;
  b.cells = b.cells.map(c => isDone(c) ? null : c);
}
export function candidates(b: Board): number[] {
  const onlyX = hasX(b);
  return b.cells.flatMap((c, i) => isTask(c) && (!onlyX || c.priority === 'X') ? [i] : []);
}
export function draw(b: Board, random = Math.random): number {
  check(active(b), 'Start a round first.');
  const pool = candidates(b);
  check(pool.length, 'There are no tasks left to draw.');
  const tickets = pool.map(i => {
    const p = (b.cells[i] as Task).priority;
    return p === 'X' ? 1 : b.weights[p];
  });
  let ticket = Math.floor(random() * tickets.reduce((a,b) => a+b,0));
  for (const [index, weight] of tickets.entries()) {
    if (ticket < weight) return pool[index];
    ticket -= weight;
  }
  throw new Error('Invalid random draw.');
}
export const shuffleCost = (b: Board) => b.cells.filter(isDone).length;
function lineNames(b: Board) {
  return lines(b).map(line=>line.join(',')).join('|');
}
function distanceToSuccess(b: Board) {
  if (active(b)?.success) return 0;
  const remaining = b.cells.filter(isTask).length;
  if (!remaining) return null;
  const must = b.cells.flatMap((t,i)=>isTask(t) && t.priority==='X' ? [i] : []);
  let best = remaining;
  for (const axis of axes(b)) {
    if (axis.some(i=>b.cells[i]===null)) continue;
    best = Math.min(best,new Set([...must,...axis.filter(i=>isTask(b.cells[i]))]).size);
  }
  return best;
}
export function recordDraw(b: Board,index: number,at = Date.now()) {
  const task = b.cells[index];
  const pool = candidates(b);
  check(active(b) && isTask(task) && pool.includes(index),'The draw changed. Please draw again.');
  task.placement ??= newId();
  recordEvent(b,'drawn',{...taskData(task),square:index,size:b.size,eligible:pool.length,
    completed:shuffleCost(b),mustDo:hasX(b)?1:0},at);
}
function cellKey(c: Cell) {
  if (isDone(c)) return 'done';
  if (!c) return 'empty';
  const {placement: _placement,...contents} = c;
  return JSON.stringify(contents);
}
export function shuffle(b: Board, random = Math.random, at = Date.now()) {
  check(active(b), 'Start a round first.');
  const cost = shuffleCost(b);
  check(b.balance >= cost, 'There are not enough points to shuffle.');
  const groups = b.grouped ? b.rows.map((_, i) => b.cells.slice(i * b.size, (i + 1) * b.size)) : [b.cells.slice()];
  const movable = groups.find(g => new Set(g.map(cellKey)).size > 1);
  check(movable, 'There is no different arrangement to shuffle into.');
  for (const g of groups) {
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
  }
  if (groups.flat().every((c, i) => cellKey(c) === cellKey(b.cells[i]))) {
    const j = movable.findIndex(c => cellKey(c) !== cellKey(movable[0]));
    [movable[0], movable[j]] = [movable[j], movable[0]];
  }
  b.cells = groups.flat();
  b.balance -= cost;
  if (cost) {
    const day = active(b)!.day;
    const spending = b.shuffleSpending ??= {};
    spending[day] = (spending[day] ?? 0) + cost;
  }
  evaluate(b);
  recordEvent(b,'shuffled',{completed:cost,size:b.size,lines:lineNames(b)},at);
}
export type ResetScope = 'all' | 'today' | 'grid';

// Completed marks move when shuffled. Earlier saves have anonymous marks, so
// pair their remaining completion records with unassigned marks in board order.
function reopenRoundTasks(b: Board, round: Round) {
  const entries = b.history.filter(e => e.round === round.id);
  const assigned = new Set(b.cells.flatMap(c => isDone(c) && c.entry !== undefined ? [c.entry] : []));
  const legacy = entries.filter((_,i) => !assigned.has(i));
  b.cells = b.cells.map(c => {
    if (!isDone(c)) return c;
    const entry = c.entry === undefined ? legacy.shift() : entries[c.entry];
    check(entry, 'A completed square has no matching task in this save.');
    const { round: _round, at: _at, points: _points, activityDay: _day, ...task } = entry;
    return task;
  });
}
export function balanceAfterDayReset(b: Board, day: string) {
  const rounds = new Set(b.rounds.filter(r => r.day === day).map(r => r.id));
  const earned = b.history.reduce((sum,e) => sum + (rounds.has(e.round) ? e.points : 0),0);
  return Math.max(0,b.balance - earned + (b.shuffleSpending?.[day] ?? 0));
}
export function resetBoard(b: Board, scope: ResetScope, now = new Date()) {
  const open = active(b);
  if (scope === 'grid') {
    b.cells.forEach((t,i)=>{ if (isTask(t)) recordEvent(b,'removed',{...taskData(t),square:i},+now); });
    if (open) finish(b,+now);
    b.cells.fill(null);
    return;
  }
  const day = roundDay(now,b.dayStart);
  const removed = new Set(b.rounds.filter(r => scope === 'all' || r.day === day).map(r => r.id));
  b.events = scope === 'all' ? [] : b.events.filter(e=>e.day !== day);
  if (open && removed.has(open.id)) reopenRoundTasks(b,open);
  b.balance = scope === 'all' ? 0 : balanceAfterDayReset(b,day);
  if (scope === 'all') delete b.shuffleSpending;
  else if (b.shuffleSpending) delete b.shuffleSpending[day];
  b.history = b.history.filter(e => !removed.has(e.round));
  b.rounds = b.rounds.filter(r => !removed.has(r.id));
  for (const cell of b.cells) {
    if (!isTask(cell)) continue;
    for (const step of cell.steps?.slots ?? []) {
      if (step?.done && (scope === 'all' || step.doneDay === day)) {
        step.done = false;
        delete step.doneDay;
      }
    }
  }
}
export function resize<T>(slots: (T | null)[], old: number, size: number): (T | null)[] {
  check(Number.isInteger(size) && size >= 2 && size <= MAX_SIZE, 'Choose a size from 2 to 12.');
  const next = Array<T | null>(size * size).fill(null);
  slots.forEach((value, i) => {
    if (value === null) return;
    const row = Math.floor(i / old), col = i % old;
    check(row < size && col < size, 'Move tasks out of the removed rows or columns first.');
    next[row * size + col] = value;
  });
  return next;
}
export function resizeBoard(b: Board, size: number) {
  check(!active(b), 'Resize between rounds.');
  b.cells = resize(b.cells, b.size, size);
  b.rows = Array.from({ length: size }, (_, i) => b.rows[i] ?? '');
  b.size = size;
}
export function place(b: Board, kind: Library, from: number, to: number, at = Date.now()) {
  const task = b[kind].slots[from];
  check(task && b.cells[to] === null, 'Choose an empty board square.');
  const placed = {...structuredClone(task),placement:newId()};
  b.cells[to] = placed;
  recordEvent(b,'placed',{...taskData(placed),square:to,size:b.size},at);
  if (kind === 'temporary') b[kind].slots[from] = null;
}
export function move(b: Board, from: number, to: number) {
  check(!active(b), 'Use Shuffle to rearrange an active round.');
  check(isTask(b.cells[from]) && to >= 0 && to < b.cells.length, 'Select a task to move.');
  [b.cells[from], b.cells[to]] = [b.cells[to], b.cells[from]];
}
export function removeFromBoard(b: Board, i: number, destination?: {library: Library; slot?: number}) {
  const task = b.cells[i];
  check(isTask(task), 'Select an unfinished task.');
  const libraryName = task.library === 'daily' ? 'everyday' : 'one-off';
  check(!destination || destination.library === task.library, `Return this task to the ${libraryName} library.`);
  const slots = b[task.library].slots;
  // Everyday placements normally already have a template in the library.
  if (task.library === 'temporary' || (destination && !slots.some(t => t?.source === task.source))) {
    const free = destination?.slot ?? slots.indexOf(null);
    check(free !== -1, `Make room in the ${libraryName} library first.`);
    check(slots[free] === null, `Choose an empty slot in the ${libraryName} library.`);
    const {placement: _placement,...returned} = task;
    slots[free] = returned;
  }
  deletePlacedTask(b,i);
}
export function deletePlacedTask(b: Board, i: number) {
  const task = b.cells[i];
  check(isTask(task), 'Select an unfinished task.');
  b.cells[i] = null;
  recordEvent(b,'removed',{...taskData(task),square:i});
  evaluate(b);
}
export function dayResults(b: Board) {
  const days = new Map<string, 'Success' | 'In progress' | 'Unfinished'>();
  for (const round of b.rounds) {
    const previous = days.get(round.day);
    if (round.success || previous === 'Success') days.set(round.day, 'Success');
    else if (round.end === null || previous === 'In progress') days.set(round.day, 'In progress');
    else days.set(round.day, 'Unfinished');
  }
  return days;
}
