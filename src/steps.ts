import { tr } from './i18n.ts';
import { esc } from './copy.ts';
import { MAX_SIZE, resize } from './rules.ts';
import type { StepGrid, Task } from './rules.ts';

export function editSteps(dialog: HTMLDialogElement, task: Task, template: boolean,
  getProgressDay: () => string, save: (steps?: StepGrid) => Promise<boolean>) {
  let grid: StepGrid = structuredClone(task.steps ?? { size: 2, slots: Array(4).fill(null) });
  let editing = template || !grid.slots.some(Boolean);
  let selected: number | null = null;
  let confirming = false;
  let saving = false;
  const button = (label: string, onClick: () => void, primary = false) => {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = tr(label); el.onclick = onClick;
    if (primary) el.className = 'primary';
    return el;
  };
  function paint() {
    dialog.innerHTML = `<section class="step-editor"><h2 id="dialog-title">${tr("Task steps")}</h2>
      <p class="step-path"></p><p class="muted"></p><div class="sectiontop sectiongap"><span class="step-count"></span></div>
      <div class="scroll-grid"><div class="step-grid"></div></div>
      <p class="step-error" role="status"></p><div class="actions"></div></section>`;
    dialog.setAttribute('aria-labelledby','dialog-title');
    dialog.querySelector('.step-path')!.textContent = task.title;
    dialog.querySelector('.muted')!.innerHTML = esc(tr(editing ? 'Give each small step its own square.' :
      'Select a step to finish it. You decide when the main task is complete.'));
    const canvas = dialog.querySelector<HTMLElement>('.step-grid')!;
    canvas.style.setProperty('--n',String(grid.size));
    const count = dialog.querySelector<HTMLElement>('.step-count')!;
    const updateCount = () => { const done = grid.slots.filter(s => s?.done).length, total = grid.slots.filter(Boolean).length; count.textContent = tr('{0} of {1} steps completed',done,total); };
    updateCount();
    const feedback = dialog.querySelector<HTMLElement>('.step-error')!;
    const actions = dialog.querySelector<HTMLElement>('.actions')!;
    const names = new Map<number,HTMLInputElement>();
    function sync() {
      for (const [i,input] of names) {
        const title = input.value.trim();
        if (!title && grid.slots[i]?.steps?.slots.some(Boolean)) {
          feedback.textContent = tr('Keep a name for the step containing earlier saved notes.');
          input.focus(); return false;
        }
        grid.slots[i] = title ? { ...grid.slots[i], title, done:false } : null;
      }
      updateCount(); return true;
    }
    if (editing) {
      const label = document.createElement('label'); label.textContent = tr('Side length');
      const size = document.createElement('input');
      size.type = 'number'; size.min = '2'; size.max = String(MAX_SIZE); size.value = String(grid.size);
      label.append(size); count.before(label);
      size.onchange = () => {
        if (!sync()) return;
        try {
          grid.slots = resize(grid.slots,grid.size,size.valueAsNumber); grid.size = size.valueAsNumber; paint();
        } catch (err) { feedback.textContent = tr((err as Error).message); size.value = String(grid.size); }
      };
    }
    grid.slots.forEach((step,i) => {
      if (editing && !step?.done) {
        const input = document.createElement('input'); input.maxLength = 240;
        input.value = step?.title ?? ''; input.placeholder = String(i+1);
        input.setAttribute('aria-label',tr('Step {0} name',i+1));
        input.onchange = sync;
        const square = document.createElement('div'); square.className = 'step-square';
        const label = document.createElement('label'); label.textContent = tr('Step {0}',i+1); label.append(input); square.append(label); canvas.append(square); names.set(i,input);
      } else {
        const cell = button(step?.done ? '✓' : step?.title ?? '·',() => { selected = i; confirming = false; paint(); });
        cell.textContent = step?.done ? '✓' : step?.title ?? '·';
        cell.className = 'cell ' + (step?.done ? 'done' : !step ? 'empty' : selected === i ? 'selected' : '');
        cell.disabled = !step || step.done || saving;
        cell.setAttribute('aria-label',tr('Step {0}, {1}',i+1,step?.done ? tr('Completed') : step?.title ?? tr('Empty')));
        canvas.append(cell);
      }
    });

    // Older saves can contain a deeper tree. Show its text and completion state
    // as read-only notes; re-saving leaves the original tree intact.
    const notes = document.createElement('ul');
    function listEarlier(g: StepGrid, path: string) {
      for (const s of g.slots) if (s) {
        const name = path + ' / ' + s.title;
        const item = document.createElement('li'); item.textContent = s.done ? tr('{0} (completed)',name) : name;
        notes.append(item); if (s.steps) listEarlier(s.steps,name);
      }
    }
    for (const s of grid.slots) if (s?.steps) listEarlier(s.steps,s.title);
    if (notes.childElementCount) {
      const detail = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = tr('Earlier saved steps'); detail.append(summary,notes); feedback.before(detail);
    }
    async function persist(close: boolean) {
      if (saving) return;
      saving = true;
      try {
        const ok = await save(grid.slots.some(Boolean) ? structuredClone(grid) : undefined);
        if (!ok || !dialog.open) return;
        if (close) dialog.close();
        else { selected = null; confirming = false; }
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not save steps.';
        feedback.textContent = tr(text);
        return;
      } finally { saving = false; }
      if (dialog.open && !close) paint();
    }
    if (editing) {
      actions.append(button('Cancel',() => dialog.close()),button('Save steps',() => { if (sync()) void persist(true); },true));
    } else if (confirming && selected !== null) {
      const step = grid.slots[selected]!;
      feedback.textContent = tr('Complete “{0}”?',step.title);
      actions.append(button('Cancel',() => { confirming = false; paint(); }),
        button('Confirm completion',() => {
          if (!saving) { step.done = true; step.doneDay = getProgressDay(); void persist(false); }
        },true));
    } else {
      actions.append(button('Edit steps',() => { editing = true; paint(); }),button('Close',() => dialog.close()));
      if (selected !== null) actions.append(button('Complete step',() => { confirming = true; paint(); },true));
    }
  }
  paint(); dialog.showModal();
}
