import './styles.css';
import { tr, language, setLanguage } from './i18n.ts';
import { esc } from './copy.ts';
import * as game from './rules.ts';
import type { Board, Task, Library, Priority, Workspace } from './rules.ts';
import { channel, exportBoard, exportSave, importSave, loadOrCommit } from './storage.ts';
import type { Loaded } from './storage.ts';
import { editSteps } from './steps.ts';
import { bindNoteFields, noteDetails, noteFields, notePreview } from './task-notes.ts';
import { boardPurpose, guide, updates } from './guide.ts';
import { bindMetricHints, helpHint, repositionMetricHint } from './metric-hints.ts';
import { history } from './history.ts';
import { bindActivityChart } from './activity-calendar.ts';
import { refreshCohort } from './activity-history.ts';
import type { DayFilter } from './metrics.ts';
import { sampleBoard, SAMPLE_VERSION, upgradedSampleName } from './sample.ts';
import { UnsupportedSave } from './archive.ts';

type Tab = 'Board' | 'Set up' | 'Stats' | 'Guide' | 'Update';
type Source = { kind: Library | 'board'; index: number };
const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const fileInput = document.querySelector<HTMLInputElement>('#import')!;
const notice = document.querySelector<HTMLElement>('#notice')!;

const btn = (action: string, label: string, cls = '', disabled = false) =>
  `<button type="button" data-action="${esc(action)}" class="${cls}" ${disabled ? 'disabled' : ''}>${esc(tr(label))}</button>`;
let loaded: Loaded;
let boardId = '';
let tab: Tab = 'Board';
let historyFilter: DayFilter = 'All';
let categoryAscending = false;
let selected: number | null = null;
let source: Source | null = null;
let lastDrag: Source | null = null;
let busy = false;
let animation = 0;
let timer = 0;
function message(text: string) {
  clearTimeout(timer);
  notice.textContent = tr(text);
  timer = window.setTimeout(() => { notice.textContent = ''; }, 6000);
}
function report(err: unknown) { message(err instanceof Error ? err.message : String(err)); }
function board() { return loaded.state.boards.find(b => b.id === boardId)!; }
function resetSelection() { selected = null; source = null; lastDrag = null; animation++; }
function switchTab(t: Tab) { tab = t; resetSelection(); render(); }
async function reload() {
  loaded = await loadOrCommit();
  if (!loaded.state.boards.some(b => b.id === boardId)) boardId = loaded.state.defaultId;
  resetSelection();
  if (dialog.open) dialog.close();
  render();
}
async function commit(change: (b: Board, state: Workspace) => void): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const state = structuredClone(loaded.state);
    const current=state.boards.find(b => b.id === boardId)!;
    change(current,state);
    game.discardUnusedImages(current);
    loaded = await loadOrCommit({ state, revision: loaded.revision });
    animation++;
    return true;
  } catch (err) {
    await reload(); report(err); return false;
  } finally { busy = false; }
}
function showDialog(title: string, content: string, submit: string, onSubmit: (data: FormData) => Promise<void>) {
  dialog.innerHTML = `<form><h2 id="dialog-title">${esc(tr(title))}</h2>${content}<div class="actions">
    ${btn('cancel-dialog','Cancel','quiet')}<button class="primary">${esc(tr(submit))}</button></div></form>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  const form = dialog.querySelector('form')!;
  form.onsubmit = event => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(form);
    const submitButton = form.querySelector<HTMLButtonElement>('button.primary')!;
    if(submitButton.disabled) return;
    submitButton.disabled = true;
    void onSubmit(data).then(() => {
      if (dialog.open && dialog.contains(form)) dialog.close();
    }).catch(report).finally(() => { submitButton.disabled = false; });
  };
  dialog.querySelector<HTMLButtonElement>('[data-action="cancel-dialog"]')!.onclick = () => dialog.close();
  dialog.showModal();
}
function confirmAction(title: string, text: string, label: string, callback: () => Promise<void>, cancel = 'Cancel') {
  showDialog(title, `<p>${esc(text)}</p>`, label, callback);
  dialog.querySelector<HTMLButtonElement>('[data-action="cancel-dialog"]')!.textContent = tr(cancel);
}
function showMenu(title: string, description: string, buttons: string) {
  dialog.innerHTML = `<h2 id="dialog-title">${esc(tr(title))}</h2><p>${esc(tr(description))}</p><div class="stack sectiongap">${buttons}</div>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => {
    dialog.close(); void action(button.dataset.action!).catch(report);
  });
  dialog.showModal();
}
const resetLabels = { all:'Reset all progress', today:"Reset today's progress", grid:'Clear all squares' } as const;
function confirmReset(scope: game.ResetScope) {
  const b = board();
  const day = game.roundDay(new Date(),b.dayStart);
  const effects = {
    all: 'Delete every round and completion record and set points to zero. Tasks completed in the open round return to the board. All placed task steps reopen.',
    today: tr('Remove rounds assigned to {0} (board day starts at {1} local time) and their completions. Points after reset: {2}. Reopen tasks from an affected open round and placed steps marked for this day.',day,b.dayStart,game.balanceAfterDayReset(b,day)),
    grid: 'Remove every placed task, including one-offs, steps and completion marks. Close any open round with its current result. Keep points and history.'
  };
  confirmAction(tr('{0}?',tr(resetLabels[scope])),tr('Board “{0}”. {1} Both libraries are kept. This cannot be undone.',b.name,tr(effects[scope])),resetLabels[scope],async () => {
    const now = new Date();
    if (scope === 'today' && game.roundDay(now,b.dayStart) !== day) {
      message('A new board day has begun. Open Reset again to review the date.'); return;
    }
    if (await commit(current => game.resetBoard(current,scope,now))) {
      resetSelection(); render(); message(scope === 'grid' ? 'All squares cleared.' : 'Progress reset.');
    }
  });
  dialog.querySelector<HTMLButtonElement>('[data-action="cancel-dialog"]')!.focus();
}
function dueLabel(due: string) {
  if (!due) return '';
  const now = new Date(), tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const today = game.dateKey(now);
  if (due < today) return tr('Overdue · {0}',due);
  if (due === today) return tr('Due today');
  if (due === game.dateKey(tomorrow)) return tr('Due tomorrow');
  return tr('Due {0}',due);
}
function grid(b: Board) {
  const winning = new Set(game.lines(b).flat());
  return `<div class="scroll-grid"><div class="grid ${b.grouped ? 'labeled' : ''}" style="--n:${b.size}">${b.cells.map((c,i) => {
    const row = Math.floor(i / b.size);
    const rowLabel = b.grouped && i % b.size === 0 ? `<span class="rowname">${b.rows[row] ? esc(b.rows[row]) : esc(tr('Row {0}',row+1))}</span>` : '';
    const task = game.isTask(c);
    const priority = task ? `<small class="priority-${c.priority}">${esc(tr(game.priorityNames[c.priority]))}</small>` : '';
    const metadata = task ? [c.minutes ? tr('{0} min',c.minutes) : '', dueLabel(c.due)].filter(Boolean).join(' · ') : '';
      const tags = task ? [esc(c.category),metadata && esc(metadata)].filter(Boolean).join(' · ') : '';
    const name = task ? c.title : tr(c ? 'Completed' : 'Empty');
    return rowLabel + `<button type="button" data-cell="${i}" aria-label="${esc(tr('Row {0}, column {1}, {2}',row+1,i%b.size+1,name))}" aria-pressed="${selected === i}"
      draggable="${tab === 'Set up' && task}" class="cell ${task ? '' : c ? 'done' : 'empty'} ${winning.has(i) ? 'winning' : ''} ${selected === i ? 'selected' : ''}">
      ${task ? `<span class="priority-${c.priority}">${esc(c.title)}</span>` : c ? '✓' : '·'}${priority}${tags ? `<small>${tags}</small>` : ''}</button>`;
  }).join('')}</div></div>`;
}
function libraryPanel(b: Board, k: Library) {
  const shelf = b[k];
  const pick = source?.kind === k ? source.index : null;
  return `<section class="panel" data-shelf="${k}"><div class="sectiontop"><div class="board-name"><h2>${esc(tr(k === 'daily' ? 'Everyday library' : 'One-off library'))}</h2>${b.sample ? helpHint('shelf-'+k,tr('About {0}',tr(k==='daily'?'Everyday library':'One-off library')),"Select a library task, then select an empty board square. Everyday tasks place a copy. One-off tasks move out of the library. An empty library slot opens the task form.") : ''}</div>
    ${sampleButton(b,`size-${k}`,'Resize','small')}</div><p class="muted">${esc(tr(k === 'daily' ? 'Place a copy each time you use a task.' : 'Placing a task moves it onto the board.'))}</p>
    <div class="scroll-grid sectiongap"><div class="shelfgrid" style="--n:${shelf.size}">${shelf.slots.map((t,i) =>
      `<button data-library="${k}" data-slot="${i}" draggable="${!!t}" class="libcell ${t ? 'priority-' + t.priority : 'vacant'} ${pick === i ? 'selected' : ''}" aria-label="${esc(tr('{0} slot {1}, {2}',tr(k === 'daily' ? 'Everyday' : 'One-off'),i+1,t?.title || tr('Add task')))}">${t ? esc(t.title) : esc(tr('+ Add'))}</button>`).join('')}
    </div></div>${pick !== null ? `<div class="actions sectiongap">${sampleButton(b,'edit-library','Edit task','small')}${sampleButton(b,'steps','Task steps','small')}${sampleButton(b,'delete-library','Delete task','small quiet')}</div>` : ''}</section>`;
}
const sampleActionTips = {
  'settings': "Open this board’s settings to change its size, day start, draw weights and row grouping.",
  'properties': "Edit this square’s task name, priority, category, planned time or note.",
  'steps': "Open this task’s steps to add or review smaller actions.",
  'remove': "Take this task off the board. An everyday original stays in its library. A one-off returns to an empty library slot.",
  'back': "Return to the board and continue the same round.",
  'setup': "Open Set up to place tasks from the libraries or return a square to its library.",
  'resize': "Change this library’s side length. Before shrinking, move tasks out of the slots you want to remove.",
  'edit-library': "Edit the library original for future placements.",
  'delete-library': "Review the task name before confirming removal from this library.",
  start: "Start playing with this layout. You can draw a task or choose a square yourself.",
  draw: "Draw one unfinished square using the board’s priorities. You can follow the suggestion or pick a different square.",
  complete: "Review the selected task, then confirm to clear only this square and earn its points.",
  finish: "Review the end-of-round prompt. Confirm to stop and carry the unfinished squares into the next round.",
};
function sampleButton(b:Board,action:keyof typeof sampleActionTips | `size-${Library}`,label:string,cls='',disabled=false) {
  const control=btn(action,label,cls,disabled);
  if(!b.sample) return control;
  const key=action==='size-daily' || action==='size-temporary' ? 'resize' : action;
  return `<div class="sample-action">${control}${helpHint('action-'+action,tr('About {0}',tr(label)),sampleActionTips[key])}</div>`;
}
function controls(b: Board) {
  const r = game.active(b);
  const t = selected === null ? null : b.cells[selected];
  const task = game.isTask(t);
  if (tab === 'Set up') {
    const chosen = source && source.kind !== 'board' ? b[source.kind].slots[source.index] : null;
    return `<aside class="panel"><h2>${tr("Set up your board")}</h2><p class="detail muted">${chosen ? esc(tr('Place “{0}” in an empty square.',chosen.title)) :
      esc(tr('Pick a library task, then click an empty square. Dragging works too.'))}</p>
      <div class="stack">${sampleButton(b,'settings','Board settings')}${task ? sampleButton(b,'properties','Edit task') + sampleButton(b,'steps','Task steps') + sampleButton(b,'remove',t.library === 'temporary' ? 'Return to one-off library' : 'Remove from board') : ''}
      ${sampleButton(b,r ? 'back' : 'start',r ? 'Return to round' : 'Start round','primary', !r && !b.cells.some(game.isTask))}</div></aside>${notePreview(b,task?t:chosen)}`;
  }
  return `<aside class="panel"><h2>${esc(tr(task ? 'Selected task' : r ? 'Choose a task' : 'Your next round'))}</h2>
    <p class="detail ${task ? 'priority-' + t.priority : 'muted'}">${task ? esc(t.title) : esc(tr(r ? 'Click a square yourself or let the board pick one.' :
    b.cells.some(game.isTask) ? 'Your tasks are ready when you are.' : 'Add a few tasks from your libraries to get started.'))}</p>
    <div class="stack">${r ? sampleButton(b,'draw','Draw a task',task ? '' : 'primary', !b.cells.some(game.isTask)) +
      (task ? sampleButton(b,'complete','Complete task','primary') : '') : b.cells.some(game.isTask) ? sampleButton(b,'start','Start round','primary') : btn('setup','Set up board','primary')}
      ${task ? sampleButton(b,'properties','Edit task') + sampleButton(b,'steps','Task steps') : ''}
      ${r ? sampleButton(b,'finish','End round','quiet') : ''}</div>
      </aside>${notePreview(b,task?t:null)}`;
}
function render() {
  const b = board(), r = game.active(b);
  const boardView = tab !== 'Guide' && tab !== 'Update';
  const showPurpose = tab === 'Board' && !r;
  const titles: Record<Tab,string> = {Board:'Task board','Set up':'Set up',Stats:'Stats',Guide:'How to use ADHD Todo',Update:'Updates'};
  const finishedRounds = b.sample ? b.rounds.filter(round => round.end !== null).length : 0;
  const bingo = game.lines(b).length > 0;
  const won = r?.success;
  const feedback = bingo && game.hasX(b) ? 'Bingo! Must-do tasks remain.' : bingo ? 'Bingo! You can keep going or end the round.' :
    won ? (!b.cells.some(game.isTask) ? 'Board cleared! End the round whenever you’re ready.' : 'Round goal reached. Keep going if you like.') : '';
  app.innerHTML = `<header><div class="bar"><div class="board-picker"><div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>ADHD Todo<button type="button" class="language-toggle" data-action="language" lang="${language === 'en' ? 'zh-CN' : 'en'}">${language === 'en' ? '中文' : 'English'}</button></div>
    <select aria-label="${tr("Current board")}" id="boards">${loaded.state.boards.map(x => `<option value="${esc(x.id)}" ${x.id === b.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <nav aria-label="${tr("Views")}">${Object.keys(titles).map(v => btn('tab-'+v,v,tab === v ? 'current' : 'quiet')).join('')}</nav></div></header>
    <main><div class="headrow${showPurpose ? ' with-purpose' : ''}"><div><h1>${tr(titles[tab])}</h1>
    ${boardView ? `<p class="sub">${tab === 'Set up' ? esc(tr('Arrange the tasks for this board.')) : tab === 'Stats' ? esc(b.name) : esc(tr('{0} × {0} · {1} tasks on the board',b.size,b.cells.filter(game.isTask).length))}</p>` : ''}</div>
    ${showPurpose ? `<p class="board-purpose muted" data-board-note>${tr(boardPurpose)}</p>` : ''}
    ${boardView ? `<div class="actions">${btn('new-board','+ Board')}${btn('save-menu','Saves')}</div>` : ''}</div>
    ${boardView && b.sample ? `<p class="notice-inline" data-sample-note>${language === 'en' ? `This sample board starts with simulated activity and currently has ${finishedRounds} finished round${finishedRounds === 1 ? '' : 's'}. Try playing a round, or open Stats to explore your activity.` : tr('Sample intro',finishedRounds)}</p>` : ''}
    ${tab === 'Update' ? updates() : tab === 'Guide' ? guide(b) : tab === 'Stats' ? history(b,loaded.metrics(b.id,historyFilter),historyFilter,categoryAscending) : `<div class="layout"><section class="panel"><div class="sectiontop"><div class="board-name"><h2>${esc(b.name)}</h2>${helpHint('board-copies',tr('Why repeat a task?'),"Each eligible square gets its own chance in the draw. Put the same everyday task on the board a few times if you want to draw it more often. Each copy is one turn. You can decide what to do when it comes up.")}</div><span class="tag ${r ? 'live' : ''}">${esc(tr(r ? 'In progress' : 'Between rounds'))}</span></div>
    ${feedback ? `<p class="notice-inline" role="status">${esc(tr(feedback))}</p>` : ''}${grid(b)}
    <div class="board-tools"><span class="counter"><b>${esc(tr('{0} pts',b.balance))}</b> · <span>${esc(tr('{0} completed',game.shuffleCost(b)))}</span></span>
    <div class="actions">${r ? btn('shuffle',tr('Shuffle · {0} pts',game.shuffleCost(b)),'small', b.balance < game.shuffleCost(b)) : ''}
    ${tab === 'Board' ? sampleButton(b,'setup','Edit board','small') : ''}</div></div>
    ${tab==='Board' && b.sample && b.sampleVersion===SAMPLE_VERSION ? `<p class="sample-example muted">${tr("The sample starts with three “Write my paper” squares from one Everyday library entry. On that starting grid, writing has a 37.5% chance on the first draw. When one comes up, spend a turn on the paper. The other copies can come up later. The odds change as you play. While any Must-do remains, only Must-do squares can be drawn.")}</p>` : ''}</section><div class="stack board-sidebar">${controls(b)}</div></div>
    ${tab === 'Set up' ? `<div class="libraries">${libraryPanel(b,'daily')}${libraryPanel(b,'temporary')}</div>` : ''}`}
    </main>`;
  bindMetricHints(app);
  if(tab === 'Stats') {
    bindActivityChart(app,b,loaded.metrics(b.id,historyFilter));
  }
}
function taskForm(k: Library, index: number, square = false) {
  const b = board();
  const t = square ? b.cells[index] : b[k].slots[index];
  const current = game.isTask(t) ? t : null;
  const categories = game.boardCategories(b);
  showDialog(square ? 'Edit task' : current ? 'Edit library task' : 'Add library task', `<div class="formgrid">
    ${current ? '' : `<p id="task-start-hint" class="full muted">${tr("A project name is enough. What would you like a chance to work on today?")}</p>`}
    <label class="full">${tr("Task name")}<input name="title" autofocus required maxlength="240" ${current ? '' : `aria-describedby="task-start-hint" placeholder="${esc(tr("e.g. Write my paper"))}"`} value="${esc(current?.title ?? '')}"></label>
    <fieldset class="full"><legend>${tr("Priority")}</legend><div class="priority-options">${(['Standard','Low','X'] as Priority[]).map(p => `<label><input type="radio" name="priority" value="${p}" ${p === (current?.priority ?? 'Standard') ? 'checked' : ''}><span>${esc(tr(game.priorityNames[p]))}</span></label>`).join('')}</div></fieldset>
    <label>${tr("Planned minutes")}<input name="minutes" type="number" min="0" max="100000" step="1" value="${current?.minutes || ''}"></label>
    <label>${tr("Due date")}<input name="due" type="date" value="${esc(current?.due ?? '')}"></label>
    <label>${tr("Category")}<select name="category"><option value=""></option>${categories.map((name,i) =>
      `<option value="${i}" ${current?.category === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
      <option value="new">${tr("Add new category…")}</option></select></label>
    <label hidden>${tr("New category")}<input name="newCategory" maxlength="80" disabled required pattern=".*\\S.*"></label>
    <details class="full"><summary>${tr("Task note (optional)")}</summary>${noteFields(current)}</details></div>`, 'Save task', async data => {
      const choice = String(data.get('category'));
      const category = choice === 'new' ? String(data.get('newCategory')).trim() : choice === '' ? '' : categories[Number(choice)];
      const task: Task = { ...current, source: current?.source ?? game.newId(), library: k, title: String(data.get('title')).trim(),
        priority: data.get('priority') as Priority, category,
        minutes: Number(data.get('minutes') || 0), due: String(data.get('due')) };
      const ok = await commit(b => {
        game.check(task.title, 'Enter a task name.');
        saveNote(b,task,data);
        if (categories.length || category) b.categories = [...new Set([...categories,category].filter(Boolean))];
        if (!current && !square) game.recordEvent(b,'created',{source:task.source,library:k,category:task.category,priority:task.priority});
        if (square) b.cells[index] = task; else b[k].slots[index] = task;
        game.evaluate(b);
      });
      if (ok && !square) { source = { kind: k, index }; selected = null; }
      render();
    });
  const saveNote=bindNoteFields(dialog,b,current);
  const picker = dialog.querySelector<HTMLSelectElement>('select[name="category"]')!;
  const input = dialog.querySelector<HTMLInputElement>('[name="newCategory"]')!;
  picker.onchange = () => {
    input.disabled = picker.value !== 'new';
    input.parentElement!.hidden = input.disabled;
    if (!input.disabled) input.focus();
  };
}
function sizeField(value: number) {
  return `<label>${tr("Side length")}<input name="size" type="number" min="2" max="${game.MAX_SIZE}" value="${value}" required></label>`;
}
function settings() {
  const b = board(), r = game.active(b);
  const fieldHint=(name:string,label:string,tip:string)=>helpHint('setting-'+name,tr('About {0}',tr(label)),tip);
  const sampleHint=(name:string,label:string,tip:string)=>b.sample ? fieldHint(name,label,tip) : '';
  showDialog('Board settings', `<div class="stack"><div class="setting-field"><div class="setting-caption"><label for="setting-name">${tr("Board name")}</label>${sampleHint('name','Board name',"The board name appears in the board picker. Rename it here to make it easier to find.")}</div>
      <input id="setting-name" name="name" required maxlength="80" value="${esc(b.name)}"></div>
    <div class="setting-field"><div class="setting-caption"><label for="board-day-start">${tr("Day starts at")}</label>${fieldHint('day','Day starts at',"Choose the local time when a new board day begins. With 04:00, a round started at 03:59 belongs to the previous day. Saved rounds keep their original day.")}</div>
      <input id="board-day-start" name="dayStart" type="time" required step="60" value="${esc(b.dayStart)}"></div>
    <div class="setting-field"><div class="setting-caption"><label for="board-size">${tr("Side length")}</label>${fieldHint('size','Side length',"Side length sets both rows and columns: 3 means a 3 × 3 board. Change it between rounds, from 2 to 12. Move tasks out of squares that would be removed before shrinking.")}</div>
      <input id="board-size" name="size" type="number" required min="2" max="${game.MAX_SIZE}" value="${b.size}" ${r?'disabled':''}>
      ${r ? `<small class="muted">${tr("Board size can change between rounds.")}</small>` : ''}</div>
    <fieldset><legend class="setting-caption">${tr("Draw weights")}${sampleHint('weights','Draw weights',"Weights are tickets for each eligible square. A weight of 2 gives twice the chance of a weight of 1. Must-do tasks are drawn first.")}</legend><p class="muted">${tr("Tickets per task (1–100). More tickets give that task a higher chance.")}</p>
      <div class="formgrid">${(['Standard','Low'] as const).map(p =>
        `<label>${esc(tr(p+" weight"))}<input name="${p}" type="number" min="1" max="100" step="1" required value="${b.weights[p]}"></label>`).join('')}</div>
      <output class="muted" data-pair-odds></output></fieldset>
    <div class="setting-caption"><label><span><input style="width:auto" name="default" type="checkbox" ${loaded.state.defaultId === b.id ? 'checked disabled' : ''}>${tr("Default board")}</span></label>${sampleHint('default','Default board',"Choose this board to open automatically the next time you visit.")}</div>
    <div class="setting-caption"><label><span><input style="width:auto" name="grouped" type="checkbox" ${b.grouped ? 'checked' : ''}>${tr("Group by row (shuffle within rows)")}</span></label>
      ${fieldHint('rows','Group by row (shuffle within rows)',"Turn this on to keep tasks and completion marks in their own row when you shuffle. Turn it off to shuffle across the whole board.")}</div>
    <details ${b.grouped ? 'open' : ''}><summary ${b.sample ? `title="${tr("Give each row a name. Row names are shown when row grouping is on.")}"` : ''}>${tr("Row labels")}</summary>${b.sample ? `<small class="muted">${tr("Give each row a name. Row names are shown when row grouping is on.")}</small>` : ''}<div class="stack">${b.rows.map((s,i) =>
      `<label>${esc(tr('Row {0}',i+1))}<input name="row-${i}" maxlength="80" value="${esc(s)}"></label>`).join('')}</div></details>
      ${btn('delete-board','Delete current board','quiet')}</div>`, 'Save settings', async data => {
      await commit((b,state) => {
        const name = String(data.get('name')).trim();
        game.check(name, 'Give the board a name.');
        const dayStart = data.get('dayStart');
        game.check(game.validDayStart(dayStart),'Choose a local time for the start of the day.');
        b.dayStart = dayStart;
        const weights = {Standard:Number(data.get('Standard')), Low:Number(data.get('Low'))};
        game.check(game.validWeights(weights), 'Use whole numbers from 1 to 100.');
        b.weights = weights;
        if (!r) game.resizeBoard(b, Number(data.get('size')));
        b.name = name; b.grouped = data.has('grouped');
        b.rows = b.rows.map((_,i) => String(data.get('row-'+i) ?? '').trim());
        if (data.has('default')) state.defaultId = b.id;
      }); resetSelection(); render();
    });
  const form = dialog.querySelector('form')!;
  bindMetricHints(dialog);
  const deleteButton=form.querySelector<HTMLButtonElement>('[data-action="delete-board"]')!;
  if(b.sample) {
    deleteButton.title=tr("Review which board will be deleted before confirming.");
    form.querySelector<HTMLButtonElement>('button.primary')!.title=tr("Apply these settings to this board.");
    form.querySelector<HTMLButtonElement>('[data-action="cancel-dialog"]')!.title=tr("Close without saving your edits.");
  }
  deleteButton.onclick = () => {
    dialog.close(); void action('delete-board').catch(report);
  };
  function previewPair() {
    const data = new FormData(form);
    const weights = { Standard:Number(data.get('Standard')), Low:Number(data.get('Low')) };
    const odds = (n: number) => (100*n/(weights.Standard+weights.Low)).toLocaleString('en-US',{maximumFractionDigits:2});
    form.querySelector('output')!.innerHTML = game.validWeights(weights)
      ? esc(tr("With one of each: Standard {0}%, Low {1}%.",odds(weights.Standard),odds(weights.Low)))
      : esc(tr('Choose whole numbers from 1 to 100.'));
  }
  form.oninput = previewPair;
  previewPair();
}
async function placeOrMove(s: Source, i: number) {
  const ok = await commit(b => {
    if (s.kind === 'board') game.move(b,s.index,i);
    else game.place(b,s.kind,s.index,i);
  });
  source = null; selected = ok ? i : null; render();
}
async function chooseCell(i: number) {
  const c = board().cells[i];
  if (tab === 'Set up' && source?.kind !== 'board' && source) { await placeOrMove(source,i); return; }
  if (tab === 'Set up' && source?.kind === 'board' && !game.active(board()) && c === null) { await placeOrMove(source,i); return; }
  selected = game.isTask(c) ? i : null;
  source = tab === 'Set up' && selected !== null ? { kind: 'board', index: i } : null;
  animation++; render();
}
async function animateDraw() {
  const b = board(), pool = game.candidates(b), winner = game.draw(b), token = ++animation;
  for (let n = 0; n < 10; n++) {
    if (animation !== token) return;
    app.querySelector('.preview')?.classList.remove('preview');
    const preview = n === 9 ? winner : pool[Math.floor(Math.random() * pool.length)];
    app.querySelector(`[data-cell="${preview}"]`)?.classList.add('preview');
    await new Promise(resolve => setTimeout(resolve, 65));
  }
  if (animation === token && await commit(current => game.recordDraw(current,winner))) {
    selected = winner; render(); message(tr('Drawn: {0}',(b.cells[winner] as Task).title));
  }
}
async function action(key: string) {
  const b = board(), i = selected, task = i === null ? null : b.cells[i];
  if (key.startsWith('tab-')) { switchTab(key.slice(4) as Tab); return; }
  if (key.startsWith('size-')) {
    const k = key.slice(5) as Library;
    showDialog('Resize library',sizeField(b[k].size),'Resize',async data => {
      const size = Number(data.get('size'));
      await commit(b => { const s = b[k]; s.slots = game.resize(s.slots,s.size,size); s.size = size; });
      resetSelection(); render();
    }); return;
  }
  switch (key) {
    case 'language':
      setLanguage(language === 'en' ? 'zh-CN' : 'en');
      notice.textContent = '';
      render();
      app.querySelector<HTMLButtonElement>('.language-toggle')?.focus({preventScroll:true});
      break;
    case 'view-note':
    case 'edit-note': {
      const target:Source|null=i===null?source:{kind:'board',index:i};
      if(!target) break;
      const at=(board:Board)=>target.kind==='board'?board.cells[target.index]:board[target.kind].slots[target.index];
      const original=at(b);
      if(!game.isTask(original)) break;
      const edit=()=>{
        showDialog(original.note?'Edit note':'Add note',noteFields(original),'Save note',async data=>{
          const ok=await commit(board=>{
            const current=at(board);
            game.check(game.isTask(current) && current.source===original.source && current.placement===original.placement,'The task changed. Please reopen it.');
            saveNote(board,current,data);
          });
          if(ok) render();
        });
        const saveNote=bindNoteFields(dialog,b,original);
      };
      if(key==='view-note') noteDetails(dialog,b,original,edit); else edit();
      break;
    }
    case 'steps': {
      const target = i !== null ? { kind: 'board' as const, index: i } : source;
      if (!target) break;
      const taskAt = (b: Board) => target.kind === 'board' ? b.cells[target.index] : b[target.kind].slots[target.index];
      const parent = taskAt(b);
      if (!game.isTask(parent)) break;
      editSteps(dialog,parent,target.kind === 'daily',() => game.active(board())?.day ?? game.roundDay(new Date(),board().dayStart),async steps => {
        const ok = await commit(b => {
          const current = taskAt(b);
          game.check(game.isTask(current) && current.source === parent.source,'The task changed. Please reopen it.');
          if (steps) current.steps = steps; else delete current.steps;
        }); render(); return ok;
      }); break;
    }
    case 'setup': switchTab('Set up'); break;
    case 'back': switchTab('Board'); break;
    case 'settings': settings(); break;
    case 'new-board': {
      const hasSample = loaded.state.boards.some(x => x.sample);
      const hasCurrentSample = loaded.state.boards.some(x => x.sample && (x.sampleVersion ?? 1) >= SAMPLE_VERSION);
      const sampleOption = hasCurrentSample ? '' : btn('create-sample',hasSample ? 'Create full-grid sample' : 'Create sample board','small');
      showDialog('New board',`<label>${tr("Board name")}<input name="name" maxlength="80" required autofocus></label>${sampleOption}`,'Create board',async data => {
        const created = game.createBoard(String(data.get('name')));
        if (await commit((_,s) => { s.boards.push(created); })) boardId = created.id;
        switchTab('Board');
      });
      const createSample = dialog.querySelector<HTMLButtonElement>('[data-action="create-sample"]');
      if (createSample) createSample.onclick = async () => {
        dialog.close();
        const sample = sampleBoard();
        if (hasSample) sample.name = upgradedSampleName;
        if (await commit((_,state) => state.boards.push(sample))) {
          boardId = sample.id; historyFilter = 'All'; switchTab('Board');
        }
      };
      break;
    }
    case 'start':
      if (await commit(b => game.start(b))) switchTab('Board'); break;
    case 'draw': await animateDraw(); break;
    case 'properties': if (i !== null && game.isTask(task)) taskForm(task.library,i,true); break;
    case 'complete':
      if (i !== null && game.isTask(task)) confirmAction('Complete this task?',task.title,'Complete task',async () => {
        await commit(b => game.complete(b,i)); resetSelection(); render();
      }); break;
    case 'shuffle':
      if (await commit(b => game.shuffle(b))) { resetSelection(); render(); message('Board shuffled.'); } break;
    case 'finish': {
      const warning = game.lines(b).length > 0 && game.hasX(b);
      confirmAction('End this round?', tr(warning ? 'There are still must-do tasks for today or tomorrow. End this round anyway?' :
        'Unfinished tasks will stay in their squares for next time.'), 'End round',async () => {
        if (await commit(b => game.finish(b))) switchTab('Set up');
      },'Keep going'); break;
    }
    case 'remove':
      if (i !== null && await commit(b => game.removeFromBoard(b,i))) { resetSelection(); render(); } break;
    case 'delete-placement':
      if (i !== null && game.isTask(task)) {
        confirmAction('Delete task from board?',tr('Delete “{0}” from this square? Its notes and steps go with it. Both libraries keep their current contents.',task.title),'Delete task',async () => {
          if (await commit(current => game.deletePlacedTask(current,i))) { resetSelection(); render(); }
        });
      }
      break;
    case 'edit-library':
    case 'delete-library': {
      const s = source;
      if (!s || s.kind === 'board') break;
      const k = s.kind;
      if (key === 'edit-library') taskForm(k,s.index);
      else confirmAction('Delete library task?',b[k].slots[s.index]!.title,'Delete',async () => {
        await commit(b => { b[k].slots[s.index] = null; }); resetSelection(); render();
      }); break;
    }
    case 'save-menu':
      showMenu('Board saves','Your boards are saved in this browser. Take a SQLite file to another device to continue.',
        btn('export','Download all boards','primary') + btn('export-board','Download current board') + btn('import','Import a save') + btn('reset-menu','Reset…') + btn('close','Close','quiet')); break;
    case 'delete-board': {
      const last = loaded.state.boards.length === 1;
      const effect = last ? 'An empty board will open in its place.' : 'Your other boards will be kept.';
      confirmAction('Delete this board?',tr('Permanently delete “{0}”, including its tasks, libraries, points, rounds and history? {1}',b.name,tr(effect)),'Delete board',async () => {
        if (await commit((_,state) => game.deleteBoard(state,b.id))) {
          boardId = loaded.state.defaultId;
          historyFilter = 'All'; switchTab('Board'); message('Board deleted.');
        }
      });
      dialog.querySelector<HTMLButtonElement>('[data-action="cancel-dialog"]')!.focus();
      break;
    }
    case 'reset-menu':
      showMenu('Reset board',tr('Choose what to reset on “{0}”. You will review the change before confirming.',b.name),
        btn('reset-all',resetLabels.all) + btn('reset-today',resetLabels.today) + btn('reset-grid',resetLabels.grid) + btn('close','Cancel','quiet')); break;
    case 'reset-all': confirmReset('all'); break;
    case 'reset-today': confirmReset('today'); break;
    case 'reset-grid': confirmReset('grid'); break;
    case 'export':
    case 'export-board': {
      const single = key === 'export-board';
      const bytes = single ? await exportBoard(b) : await exportSave(loaded.state);
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:'application/vnd.sqlite3'}));
      const a = document.createElement('a'); a.href = url;
      a.download = single ? 'adhd-todo-' + b.name.replace(/[<>:"/\\|?*]/g,'_').slice(0,80) + '.sqlite' : 'adhd-todo.sqlite';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url),1000); break;
    }
    case 'import': fileInput.click(); break;
  }
}
document.addEventListener('scroll',repositionMetricHint,{capture:true,passive:true});
window.addEventListener('resize',repositionMetricHint);
app.addEventListener('click',e => {
  if (busy) return;
  const target = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!target) return;
  if (target.dataset.action) { void action(target.dataset.action).catch(report); return; }
  if (target.dataset.cell !== undefined) { void chooseCell(Number(target.dataset.cell)).catch(report); return; }
  if (target.dataset.library) {
    const k = target.dataset.library as Library, i = Number(target.dataset.slot);
    if (board()[k].slots[i]) { source = { kind: k, index: i }; selected = null; render(); }
    else taskForm(k,i);
  }
});
app.addEventListener('change',e => {
  const target = e.target as HTMLSelectElement;
  const cohort = target.closest<HTMLElement>('[data-cohort]');
  if (cohort) { refreshCohort(cohort,loaded.metrics(boardId,historyFilter).activity); return; }
  if (target.id === 'history-filter' || target.id === 'category-order') {
    if (target.id === 'history-filter') historyFilter = target.value as DayFilter;
    else categoryAscending = target.value === 'asc';
    const panels = [...app.querySelectorAll<HTMLDetailsElement>('details.report')].map(p=>p.open);
    const values = [...app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.cohort-controls [name]')].map(el=>el.value);
    render();
    app.querySelectorAll<HTMLDetailsElement>('details.report').forEach((p,i)=>{p.open=panels[i];});
    app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.cohort-controls [name]').forEach((el,i)=>{el.value=values[i];});
    refreshCohort(app.querySelector('[data-cohort]')!,loaded.metrics(boardId,historyFilter).activity);
    return;
  }
  if (target.id === 'boards' && !busy) { boardId = target.value; switchTab(tab === 'Guide' || tab === 'Update' ? tab : 'Board'); }
});
app.addEventListener('contextmenu',e => {
  const cell = (e.target as Element).closest<HTMLElement>('[data-cell],[data-library]');
  if (!cell || busy) return;
  const k = cell.dataset.library as Library | undefined;
  const i = Number(k ? cell.dataset.slot : cell.dataset.cell);
  const t = k ? board()[k].slots[i] : board().cells[i];
  if (!game.isTask(t)) return;
  e.preventDefault(); animation++;
  selected = k ? null : i; source = {kind:k ?? 'board',index:i}; render();
  const menu = document.createElement('div');
  menu.popover = 'auto'; menu.className = 'task-menu';
  menu.innerHTML = btn(k ? 'edit-library' : 'properties','Edit task') + btn('steps','Task steps') + btn('edit-note',t.note?'Edit note':'Add note');
  if (!k) menu.insertAdjacentHTML('beforeend',btn('delete-placement','Delete task'));
  app.append(menu); menu.showPopover();
  menu.style.left = Math.max(0,Math.min(e.clientX,innerWidth-menu.offsetWidth)) + 'px';
  menu.style.top = Math.max(0,Math.min(e.clientY,innerHeight-menu.offsetHeight)) + 'px';
  menu.querySelector('button')!.focus();
  menu.onclick = () => menu.hidePopover();
  menu.ontoggle = () => { if (!menu.matches(':popover-open')) menu.remove(); };
});
app.addEventListener('dragstart',e => {
  const el = (e.target as Element).closest<HTMLElement>('[draggable="true"]');
  if (!el || !e.dataTransfer) return;
  lastDrag = { kind: el.dataset.library as Library || 'board', index: Number(el.dataset.slot ?? el.dataset.cell) };
  e.dataTransfer.setData('text/plain','ADHD Todo task');
});
app.addEventListener('dragover',e => {
  if (!lastDrag) return;
  const target = e.target as Element;
  if (target.closest('[data-shelf]') || (target.closest('[data-cell]') && (lastDrag.kind !== 'board' || !game.active(board())))) e.preventDefault();
});
app.addEventListener('drop',e => {
  const s = lastDrag; lastDrag = null;
  if (!s || busy || tab !== 'Set up') return;
  e.preventDefault();
  const el = (e.target as Element).closest<HTMLElement>('[data-cell],[data-slot]');
  const shelf = (e.target as Element).closest<HTMLElement>('[data-shelf]')?.dataset.shelf as Library | undefined;
  if (el?.dataset.cell !== undefined) void placeOrMove(s,Number(el.dataset.cell)).catch(report);
  else if (s.kind === 'board' && shelf) {
    const slot = el?.dataset.slot;
    void commit(b => game.removeFromBoard(b, s.index, {library:shelf, slot:slot === undefined ? undefined : Number(slot)}))
      .then(ok => { if (ok) { resetSelection(); render(); } }).catch(report);
  }
  else if (el?.dataset.library === s.kind && s.kind !== 'board') {
    const k = s.kind, to = Number(el.dataset.slot);
    void commit(b => { const slots = b[k].slots; [slots[s.index], slots[to]] = [slots[to],slots[s.index]]; })
      .then(() => { resetSelection(); render(); }).catch(report);
  }
});
app.addEventListener('dragend',() => { lastDrag = null; });
fileInput.onchange = async () => {
  const file = fileInput.files?.[0]; fileInput.value = '';
  if (!file) return;
  try {
    const {state:imported,singleBoard} = await importSave(file);
    if (singleBoard) {
      const incoming = imported.boards[0];
      confirmAction('Add this board?',tr('Add a copy of “{0}” alongside your saved boards? Your default board stays the same.',incoming.name),'Add board',async () => {
        let id = '';
        if (await commit((_,state) => { id = game.addImportedBoard(state,incoming); })) {
          boardId = id; historyFilter = 'All'; switchTab('Board'); message('Board added.');
        }
      });
      return;
    }
    confirmAction('Replace all boards?',tr('Import {0} board(s) from “{1}”? This replaces the boards currently saved here.',imported.boards.length,file.name),'Replace boards',async () => {
      if (await commit((_,s) => Object.assign(s,imported))) {
        boardId = imported.defaultId; switchTab('Board'); message('Save imported.');
      }
    },'Cancel');
  } catch (err) { message(err instanceof UnsupportedSave ? err.message : 'This file is not a supported ADHD Todo save. Your boards are unchanged.'); }
};
channel?.addEventListener('message',e => {
  if (!busy && loaded && e.data > loaded.revision) void reload().catch(report);
});
document.documentElement.lang = language;
document.title = tr('ADHD Todo · Task board');
app.textContent = tr('Opening your board…');
void reload().catch(err => {
  app.innerHTML = `<main><h1>${tr("Cannot open the board")}</h1><p>${esc(tr(err instanceof UnsupportedSave ? err.message : 'Allow this site to save data in your browser, then reload.'))}</p></main>`;
  report(err);
});
