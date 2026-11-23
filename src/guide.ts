import { tr } from './i18n.ts';
import { desktop } from './desktop.ts';
import { esc } from './copy.ts';
import { isTask } from './rules.ts';
import type { Board } from './rules.ts';

export const boardPurpose = 'ADHD Todo is for people with ADHD. Let chance pick your first small step and a lucky Bingo be your cue to call it a day. Enjoy your round!';

const percent = (part: number, total: number) => (100 * part / total).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
export function guide(board: Board) {
  const { Standard, Low } = board.weights;
  const tasks = board.cells.filter(isTask);
  const must = tasks.filter(t => t.priority === 'X').length;
  const ns = tasks.filter(t => t.priority === 'Standard').length;
  const nl = tasks.length - must - ns;
  const total = ns * Standard + nl * Low;
  const live = must ? tr('There are {0} Must-do tasks. Each has a {1} chance. Standard and Low each have 0% until the Must-do tasks are cleared.',must,percent(1,must)) :
    total ? tr('There are {0} Standard and {1} Low tasks.',ns,nl)+' ' + [
      ns ? tr('Each Standard task has a {0} chance.',percent(Standard,total)) : '',
      nl ? tr('Each Low task has a {0} chance.',percent(Low,total)) : ''
    ].filter(Boolean).join(' ') : tr('Place a task on the board to see its draw odds here.');

  return `<div class="stack guide-page">
    <section class="panel"><h2>${tr("Core design")}</h2>
    <p class="guide-intro">${tr(boardPurpose)}</p>
    <h3>${tr("When choosing the first task feels hard")}</h3><p>${tr("Give the board two things you could start, such as picking a screenshot or packing one book. Draw once and try the square it lands on. If another task feels easier now, you can pick it yourself.")}</p>
    <h3>${tr("When stopping feels like you haven’t done enough")}</h3><p>${tr("Before you start, try telling yourself, “If I get Bingo, I can call it a day.” When a line lights up, the board gives you a stopping point you chose in advance. You can end earlier or keep going. Unfinished squares will be there next round.")}</p>
    <h3>${tr("When the whole list feels overwhelming")}</h3><p>${tr("Leave the rest in the Everyday and One-off libraries. They stay in Set up while you play. On the board you see just the squares you chose for this round, even if that’s only one.")}</p>
    <h3>${tr("When several projects are in progress")}</h3><p>${tr("A portfolio caption and a moving box can sit side by side. After one square, draw again or pick a square from another project. Each project keeps its place, so you can come back in any order.")}</p>
    </section>
    <section class="panel"><h2>${tr("Set up a round")}</h2><p>${tr("Go to Set up, add a task in a library, then click the task and an empty square. You can also drag it there. Everyday tasks stay in their library for next time. One-off tasks move onto the board. Leave squares empty if a smaller round feels right. Choose Start round when you are ready.")}</p>
    <p>${tr("Put what is on your mind on the board. If that is “Write my paper”, save it once in the Everyday library and place three copies with that same name. Each eligible copy gets a chance in the draw. When one comes up, do as much writing as suits this turn.")}</p>
    <p>${tr("In the sample, open Set up and try the One-off library. If the board is full, return one square to its library first. Hover over, focus or tap the question mark beside a control for help. In Board settings, the question marks explain the day start, side length and row grouping on every board.")}</p>
    <p>${tr("To take an unfinished task off the board, drag it back to its own library in Set up. For a one-off, drop it on an empty slot, or on the library heading to use the first empty slot. For an everyday task, the placed copy leaves the board and its library original stays as you saved it. To discard the placed task, right-click its square, choose Delete task and confirm. This clears the square and keeps both libraries as they are.")}</p></section>
    <section class="panel"><h2>${tr("How the draw works")}</h2><p>${tr("Draw a task chooses one unfinished square. You can always select any other task yourself. When Must-do tasks are present, only those squares enter the draw, all with equal chances.")}</p>
    <p>${tr("Otherwise each task gets tickets according to its priority. A task’s chance is its own tickets divided by all eligible tickets. The default is 2 tickets per Standard task and 1 per Low task. With one of each, that is 66.67% and 33.33%. With one Standard and two Low, it is 50%, 25%, 25%.")}</p>
    <p>${tr("Open Set up → Board settings → Draw weights to choose 1–100 tickets per task. Equal weights give each task an equal chance. The setting applies to this board and takes effect on the next draw. The board highlights eligible squares ten times, then leaves the drawn task selected.")}</p>
    <h3>${tr("This board")}</h3><p>${esc(tr('Standard weight: {0}. Low weight: {1}. {2}',Standard,Low,live))}</p></section>
    <section class="panel"><h2>${tr("Edit and split a task")}</h2><p>${tr("Right-click a task or select it and use Edit task. Change its title, priority, category, due date or planned minutes. Category can be blank. To reuse a new category on this board, choose Add new category…, enter a name and save the task. New Task steps grids start at 2 × 2. You can change the side length. Save the names, select a step, choose Complete step and confirm. Its text clears. The parent stays on the board until you complete it yourself. Only the parent earns points and counts toward Bingo.")}</p></section>
    <section class="panel"><h2>${tr("Task notes")}</h2><p>${tr("Open Task note (optional) when creating or editing a task. You can also right-click a task and choose Add note or Edit note. Write a reminder, attach one JPEG, PNG or WebP image, or do both. Select a square to see its Task note card below the controls. Click or tap the card to read the full note. Images are resized on this device and included in your SQLite save.")}</p></section>
    <section class="panel"><h2>${tr("Bingo and ending a round")}</h2><p>${tr("Complete a full row, column or either main diagonal. Only squares cleared this round count. With all Must-do tasks finished, a line earns success. Completing every task you placed also succeeds, even on a sparse board. You can keep going or end early. Ending with a line and an unfinished Must-do asks for confirmation. Unfinished tasks stay in their squares for the next round.")}</p></section>
    <section class="panel"><h2>${tr("Shuffle and history")}</h2><p>${esc(tr("Completing a task earns at least one point, then one per full 30 planned minutes (59 minutes gives 1, 60 gives 2). A shuffle costs one point per square completed this round. Completed marks move too. With row grouping enabled, tasks stay in their row. Round summaries in Stats use the day a round was started. In Set up → Board settings, choose Day starts at (default 04:00 local time). For this board the day starts at {0}. Existing rounds keep their assigned dates when you change it.",board.dayStart))}</p></section>
    <section class="panel"><h2>${tr("Read your stats")}</h2><p>${tr("Open Stats for the current board. Daily calendar is the default chart. Choose Per-round bars to see completions by round. Hover over or tap a day for details. A task finished in a later board day appears on that later date. Choose a day filter to update the totals and charts. Expand a day to see each round, including rounds with zero completions. First-draw adoption compares the first suggestion with the next task completed. Expand Tasks created, placed and completed to choose an intake period and see how many of those tasks are finished today.")}</p></section>
    <section class="panel"><h2>${tr("Bring your board with you")}</h2><p>${tr(desktop ? "Progress saves automatically to a SQLite file on this computer. Under Saves, Download current board includes its libraries, notes, steps and round history. Import a save → Add board opens it alongside your other boards. Download all boards makes a full backup. Import a save → Replace boards restores that backup over all your boards." : "Progress saves automatically in this browser. Under Saves, Download current board includes its libraries, notes, steps and round history. Import a save → Add board opens it alongside your other boards. Download all boards makes a full backup. Import a save → Replace boards restores that backup over the entire profile.")}</p></section>
    <section class="panel"><h2>${tr("Reset a board")}</h2><p>${tr("Open Saves → Reset… and choose an option for the current board. Reset all progress erases its history and points. Reset today's progress applies to rounds started on the current board day, using the start time set on this board. Both options restore completed tasks from an affected open round and reopen the corresponding steps on the board. Tasks from closed rounds stay off the board. Clear all squares empties the grid, including one-offs, and closes an open round with its current result. Points and history are kept. Review the board name and effects, then cancel or confirm. The libraries and board settings are kept in all three cases.")}</p></section>
  </div>`;
}
export function updates() {
  return `<div class="stack guide-page">
    <section class="panel"><h2>${tr("Latest changes")}</h2><ul>
      <li>${tr("Continue a web round in the Windows app using a SQLite save.")}</li>
      <li>${tr("Download one board and add it to another browser. Right-click an unfinished square to delete its task after confirmation. New Task steps grids start at 2 × 2.")}</li>
      <li>${tr("Set up the sample board with question marks and three ready-to-place one-off tasks. Every board now explains day start, board size and row grouping in Board settings.")}</li>
      <li>${tr("Switch between English and Simplified Chinese from the top bar.")}</li>
      <li>${tr("Drag an unfinished task from the board back to its library in Set up.")}</li>
      <li>${tr("Add text or an image to a task and open its note from a separate card below the board controls.")}</li>
      <li>${tr("Stats opens with the daily activity calendar and remembers your chart choice.")}</li>
      <li>${tr("Try a round on the sample board or explore its 30 days of simulated activity.")}</li>
      <li>${tr("Choose a saved category or add a new one when editing a task.")}</li>
      <li>${tr("Delete the current board from Set up → Board settings.")}</li>
    </ul></section>
    <section class="panel"><h2>${tr("Planned updates")}</h2><ul>
      <li>${tr("Offer optional personal insights using scripts to calculate board metrics and an AI API to help interpret them.")}</li>
      <li>${tr("Refine the draw rules and offer more ways to set a round goal.")}</li>
      <li>${tr("Add an optional task timer and Pomodoro sessions with focus and break periods.")}</li>
      <li>${tr("Support shorter time increments and show actual focus time alongside planned minutes in Stats.")}</li>
    </ul></section></div>`;
}
