import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { encode, decode, readSave } from './archive.ts';
import { workspace } from './rules.ts';
import { sampleBoard, updateSavedSample } from './sample.ts';
import type { Board, Workspace } from './rules.ts';
import { readMetrics } from './metrics.ts';
import type { BoardMetrics, DayFilter } from './metrics.ts';
import { desktop, readDesktop, writeDesktop, commandDesktop } from './desktop.ts';
import type { DesktopSnapshot } from './desktop.ts';
import type { BoardCommand } from './board-command.ts';

const engine = initSqlJs({ locateFile: () => wasmUrl, useOldExtensionFunctions: false });
const connection = desktop ? null : new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('adhd-todo-board', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('saves');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
interface Snapshot { revision: number; data: Uint8Array }
export interface Loaded { state: Workspace; revision: number; metrics: (board:string,filter:DayFilter)=>BoardMetrics }
export const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('adhd-todo-changes') : null;
function withMetrics(SQL: Awaited<typeof engine>, state: Workspace, revision: number, bytes?: Uint8Array): Loaded {
  const cache = new Map<string,BoardMetrics>();
  return {state,revision,metrics(board,filter) {
    const key = JSON.stringify([board,filter]);
    if (!cache.has(key)) cache.set(key,readMetrics(SQL,bytes ??= encode(SQL,state),board,filter));
    return cache.get(key)!;
  }};
}
async function desktopResult(snapshot: DesktopSnapshot, wrote: boolean) {
  if (!snapshot.state) throw new Error('Could not save on this device.');
  if (wrote) channel?.postMessage(snapshot.revision);
  return withMetrics(await engine,snapshot.state,snapshot.revision);
}
export async function playDesktop(board: string,revision: number,command: BoardCommand) {
  return desktopResult(await commandDesktop(board,revision,command),true);
}
// Compare and write within one IndexedDB transaction so two tabs cannot both
// commit from the same board revision. Only show a change after it commits.
export async function loadOrCommit(next?: Pick<Loaded,'state'|'revision'>): Promise<Loaded> {
  if (desktop) {
    if (next) return desktopResult(await writeDesktop(next.state,next.revision),true);
    // A second window may initialize or upgrade the sample before this window commits.
    for (;;) {
      const snapshot = await readDesktop();
      if (snapshot.state && !updateSavedSample(snapshot.state)) return desktopResult(snapshot,false);
      try {
        return await desktopResult(await writeDesktop(snapshot.state ?? workspace(sampleBoard()),snapshot.revision),true);
      } catch (error) {
        if (!(error instanceof Error && error.message === 'This board changed in another tab. Please try again.')) throw error;
      }
    }
  }
  const [SQL, db] = await Promise.all([engine, connection!]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('saves', 'readwrite');
    const store = tx.objectStore('saves');
    const req = store.get('current');
    let result: Loaded;
    let failure: unknown;
    let wrote = false;
    req.onsuccess = () => {
      try {
        const current: Snapshot | undefined = req.result;
        if (next && next.revision !== current?.revision) throw new Error('This board changed in another tab. Please try again.');
        let snapshot: Snapshot;
        const state = next?.state ?? (current ? decode(SQL,current.data) : workspace(sampleBoard()));
        if (next || !current || updateSavedSample(state)) {
          snapshot = { revision: (current?.revision ?? 0) + 1, data: encode(SQL,state) };
          if (state.boards.some(b=>b.noteImages) && snapshot.data.byteLength>64*1024*1024)
            throw new Error('This save exceeds 64 MB. Remove an attached image and try again.');
          store.put(snapshot,'current');
          wrote = true;
        } else { snapshot=current; }
        result = withMetrics(SQL,state,snapshot.revision,snapshot.data);
      } catch (err) { failure = err; tx.abort(); }
    };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not save on this device.'));
    tx.oncomplete = () => { if (wrote) channel?.postMessage(result.revision); resolve(result); };
  });
}
export async function exportSave(state: Workspace) { return encode(await engine, state); }
export async function exportBoard(board: Board) { return encode(await engine, workspace(board), 'board'); }
export async function importSave(file: File) {
  if (file.size > 64 * 1024 * 1024) throw new Error('Choose an ADHD Todo save smaller than 64 MB.');
  const save = readSave(await engine, new Uint8Array(await file.arrayBuffer()));
  if (!save.singleBoard) updateSavedSample(save.state);
  return save;
}
