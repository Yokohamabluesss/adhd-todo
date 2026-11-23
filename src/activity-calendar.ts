import { tr, language } from './i18n.ts';
import { esc } from './copy.ts';
import { roundDay } from './rules.ts';
import type { Board } from './rules.ts';
import type { BoardMetrics } from './metrics.ts';

type Day = { completed:number; starts:number; status:string; included:boolean };
export function calendarDays(board:Board, selected:BoardMetrics['days']) {
  const days=new Map<string,Day>();
  function day(key:string) {
    let value=days.get(key);
    if(!value) {
      value={completed:0,starts:0,status:'',included:false};
      days.set(key,value);
    }
    return value;
  }
  const startDays=new Set(selected.map(d=>d.day));
  const selectedRounds=new Set<string>();
  for(const r of board.rounds) {
    day(r.day);
    if(startDays.has(r.day)) selectedRounds.add(r.id);
  }
  for(const d of selected) Object.assign(day(d.day),{starts:d.n,status:d.status,included:true});
  for(const entry of board.history) {
    const d=day(entry.activityDay ?? roundDay(new Date(entry.at),board.dayStart));
    if(selectedRounds.has(entry.round)) {d.included=true; d.completed++;}
  }
  return days;
}

const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const levels=['0','1','2–3','4–6','7+'];
export function calendarGrid(days:Map<string,Day>,year:number,today:string) {
  const date=new Date(Date.UTC(year,0,1));
  const offset=date.getUTCDay();
  const cells:string[]=[],labels:string[]=[];
  let i=0;
  while(date.getUTCFullYear()===year) {
    const key=date.toISOString().slice(0,10);
    const col=Math.floor((offset+i)/7)+1;
    if(date.getUTCDate()===1) labels.push(`<span style="grid-column:${col}">${language==='en'?months[date.getUTCMonth()]:`${date.getUTCMonth()+1}月`}</span>`);
    const d=days.get(key);
    if(key<=today || d) {
      const count=d?.completed ?? 0;
      const state=d && !d.included?'excluded':count>=7?'4':count>=4?'3':count>=2?'2':count===1?'1':d?.starts?'started':'0';
      const info=state==='excluded'?tr('Activity outside the selected day filter'):
        language==='zh-CN'?tr('Calendar counts',count,d?.starts ?? 0)+(d?.status?' · '+tr(d.status):''):
        `${count} task${count===1?'':'s'} completed · ${d?.starts ?? 0} round${d?.starts===1?'':'s'} started${d?.status?' · '+d.status:''}`;
      const label=esc(key+' · '+info);
      cells.push(`<button type="button" class="cal-day" data-level="${state}" data-day="${key}" tabindex="-1" aria-label="${label}" title="${label}" style="grid-column:${col};grid-row:${date.getUTCDay()+1}"></button>`);
    }
    date.setUTCDate(date.getUTCDate()+1); i++;
  }
  const columns=Math.ceil((offset+i)/7);
  return `<div class="cal-scroll"><div class="cal-sheet" style="--weeks:${columns}">
    <div class="cal-months" aria-hidden="true">${labels.join('')}</div>
    <div class="cal-weekdays" aria-hidden="true"><span>${tr("Mon")}</span><span>${tr("Wed")}</span><span>${tr("Fri")}</span></div>
    <div class="cal-grid" role="group" aria-label="${tr('Daily activity in {0}',year)}">${cells.join('')}</div></div></div>
    <div class="cal-legend" aria-label="${tr("Tasks completed per day")}">${levels.map((label,i)=>`<span><i data-level="${i}"></i>${label}</span>`).join('')}<span><i data-level="started"></i>${tr("Started, none completed")}</span>${[...days.values()].some(d=>!d.included)?`<span><i data-level="excluded"></i>${tr("Filtered out")}</span>`:''}</div>
    <p class="cal-detail" data-day-detail></p>`;
}

const preference='adhd-todo.stats-chart';
let mode='calendar';
try { if(localStorage.getItem(preference)==='rounds') mode='rounds'; } catch { /* Storage may be unavailable. */ }
let lastYear:{board:string;year:number}|undefined;

export function bindActivityChart(root:HTMLElement,board:Board,metrics:BoardMetrics) {
  const chooser=root.querySelector<HTMLSelectElement>('#activity-chart')!;
  const bars=root.querySelector<HTMLElement>('[data-round-chart]')!;
  const calendar=root.querySelector<HTMLElement>('[data-calendar-chart]')!;
  chooser.value=mode;
  function display() {
    const showCalendar=chooser.value==='calendar';
    bars.hidden=showCalendar;calendar.hidden=!showCalendar;
    root.querySelector<HTMLElement>('[data-round-heading]')!.hidden=showCalendar;
    root.querySelector<HTMLElement>('[data-calendar-heading]')!.hidden=!showCalendar;
    if(!showCalendar) return;
    const today=roundDay(new Date(),board.dayStart);
    const days=calendarDays(board,metrics.days);
    const years=[...new Set([today,...days.keys()].map(key=>Number(key.slice(0,4))))].sort((a,b)=>b-a);
    let year=lastYear?.board===board.id && years.includes(lastYear.year)?lastYear.year:Number(today.slice(0,4));
    calendar.innerHTML=`<label class="cal-year">${tr("Year")}<select aria-label="${tr("Calendar year")}">${years.map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('')}</select></label><div data-year-grid></div>`;
    const grid=calendar.querySelector<HTMLElement>('[data-year-grid]')!;
    function drawYear() {
      grid.innerHTML=calendarGrid(days,year,today);
      const buttons=[...grid.querySelectorAll<HTMLButtonElement>('.cal-day')];
      const detail=grid.querySelector<HTMLElement>('[data-day-detail]')!;
      let current=buttons.find(b=>b.dataset.day===today) ?? buttons.at(-1);
      function select(button:HTMLButtonElement) {
        if(current) current.tabIndex=-1;
        current=button;button.tabIndex=0;
        detail.textContent=button.title;
      }
      if(current) {
        select(current);
        const scroll=grid.querySelector<HTMLElement>('.cal-scroll')!;
        scroll.scrollLeft=current.getBoundingClientRect().right-scroll.getBoundingClientRect().right+12;
      } else detail.textContent=tr('No activity recorded in this year.');
      const point=(e:Event)=>{
        if(e.target instanceof HTMLButtonElement && e.target.matches('.cal-day')) select(e.target);
      };
      grid.onpointerover=point;grid.querySelector('.cal-grid')!.addEventListener('focusin',point);grid.onclick=point;
      grid.onkeydown=e=>{
        if(!(e.target instanceof HTMLButtonElement))return;
        const step:Record<string,number>={ArrowLeft:-7,ArrowRight:7,ArrowDown:1,ArrowUp:-1};
        if(!Object.hasOwn(step,e.key))return;
        e.preventDefault();
        buttons[Math.max(0,Math.min(buttons.length-1,buttons.indexOf(e.target)+step[e.key]))]?.focus();
      };
    }
    calendar.querySelector('select')!.onchange=e=>{
      year=Number((e.target as HTMLSelectElement).value);
      lastYear={board:board.id,year};drawYear();
    };
    drawYear();
  }
  chooser.onchange=()=>{
    mode=chooser.value;
    try {localStorage.setItem(preference,mode);} catch { /* Keep the choice for this session. */ }
    display();
  };
  display();
}
