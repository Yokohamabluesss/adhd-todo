import { tr } from './i18n.ts';
import { esc } from './copy.ts';

const tips = {
  total: ['Task completions','Include early-stop days. If a week felt unproductive, look in the log for one thing you are glad you finished.'],
  category: ['Completions by category','If a category you care about has few finishes, check how many tasks you placed. Try giving it a square or making one of its tasks smaller.'],
  library: ['Completions by library','If one-offs crowd out a routine you want to keep, check how often you placed it. Try reserving one square for a small everyday task.'],
  priority: ['Completions by priority','If most finishes are Must-do tasks, review which ones really had a deadline. You can also choose a less urgent task yourself.'],
  tasks: ['Counts by task','Pick a task you finish repeatedly. Could its wording or small first step help you reshape one you keep putting off?'],
  log: ['Completion log','Look back at what you actually finished on a difficult day. Pick one task you would like to repeat or build on.'],
  days: ['Round days','Expand a successful day and an unfinished day. If several short rounds worked well, try that rhythm when time is tight.'],
  pace: ['Tasks per finished round','Use the median to plan an ordinary round. A few unusually long rounds can lift the average above what usually fits.'],
  latency: ['Time to first completion','Check rounds without a finish, too. If the first finish often takes longer than expected, recall any breaks and try a smaller opening task.'],
  adoption: ['First-draw adoption','Look at draws with several choices. If you often pass on the suggestion, what did you want to do instead? Try picking that task yourself next time.'],
  intake: ['Tasks created and placed','If you keep saving ideas in a category but rarely place them, try putting one small idea on the board before adding another.'],
  rate: ['Placement completion rate','Compare batches of similar age. If many older tasks are still on the board, try placing fewer. If many were removed, revisit what you want to keep.'],
  gap: ['Distance at early stop','Check how often you end early. If you regularly stop several tasks short, try a lighter round. If you were one away, consider whether you had already done enough.'],
  layout: ['Draw positions and Bingo lines','Compare boards of the same size. A busy square may often hold a Must-do. If the same line keeps forming, try a different layout next round.'],
  redraw: ['Draw and shuffle timing','If you often redraw before finishing a square, try choosing your first task yourself and see which way feels easier.']
} as const;

export function metricHint(key:keyof typeof tips) {
  const [label,text]=tips[key];
  return helpHint(key,tr('How to read {0}',tr(label)),text);
}

export function helpHint(key:string,label:string,text:string) {
  return `<span class="metric-hint"><button type="button" aria-label="${esc(label)}" aria-describedby="tip-${key}" popovertarget="tip-${key}"><span aria-hidden="true">?</span></button><span class="metric-tip" id="tip-${key}" popover="auto" role="tooltip">${esc(tr(text))}</span></span>`;
}

function position(tip:HTMLElement,button:HTMLElement) {
  const rect=button.getBoundingClientRect(), margin=8;
  const left=Math.max(margin,Math.min(rect.left,document.documentElement.clientWidth-tip.offsetWidth-margin));
  const top=rect.bottom+tip.offsetHeight+margin<=innerHeight ? rect.bottom : Math.max(margin,rect.top-tip.offsetHeight);
  tip.style.left=left+'px';
  tip.style.top=top+'px';
}

export function bindMetricHints(root:HTMLElement) {
  for(const wrap of root.querySelectorAll<HTMLElement>('.metric-hint')) {
    const button=wrap.querySelector('button')!,tip=wrap.querySelector<HTMLElement>('.metric-tip')!;
    let pinned=false;
    function show() {
      tip.showPopover();
      position(tip,button);
    }
    wrap.onpointerenter=e=>{if(e.pointerType==='mouse') show();};
    wrap.onpointerleave=e=>{if(e.pointerType==='mouse' && !pinned && !button.matches(':focus-visible')) tip.hidePopover();};
    tip.ontoggle=()=>{if(!tip.matches(':popover-open')) pinned=false;};
    button.onfocus=()=>{if(button.matches(':focus-visible')) show();};
    button.onblur=()=>{pinned=false;tip.hidePopover();};
    button.onclick=e=>{
      e.preventDefault();
      pinned=!(pinned && tip.matches(':popover-open'));
      if(pinned) show(); else tip.hidePopover();
    };
  }
}

// Keep an open tip beside its control when a panel or the viewport scrolls.
export function repositionMetricHint() {
  const tip=document.querySelector<HTMLElement>('.metric-tip:popover-open');
  if(tip) position(tip,tip.parentElement!.querySelector('button')!);
}
