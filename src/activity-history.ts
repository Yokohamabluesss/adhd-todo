import { tr, language } from './i18n.ts';
import { metricHint } from './metric-hints.ts';
import { esc } from './copy.ts';
import type { ActivityMetrics } from './activity-metrics.ts';
import { dateKey, priorityNames } from './rules.ts';

type Dimension = 'day' | 'category' | 'library' | 'priority';
const rate = (n:number,total:number) => total ? (100*n/total).toLocaleString('en-US',{maximumFractionDigits:1})+'%' : '—';

function table(columns:string[],rows:(number|string)[][]) {
  return `<div class="report-scroll"><table><thead><tr>${columns.map(c=>`<th scope="col">${esc(tr(c))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function adoptionReport(a:ActivityMetrics) {
  if (!a.adoption.length) return `<p class="muted">${tr("No recorded first draws on these days.")}</p>`;
  const groups = [undefined,false,true].map(single=>{
    const entries=a.adoption.filter(e=>single===undefined || e.single===single);
    const count=(name:string)=>entries.reduce((n,e)=>n+(e.outcome===name?e.n:0),0);
    const adopted=count('Adopted'), decided=adopted+count('Not adopted'), pending=count('Pending');
    return [tr(single===undefined?'All first draws':single?'One eligible task':'Multiple eligible tasks'),adopted,decided,pending,rate(adopted,decided)];
  });
  return table(['First draw','Adopted','Decided','Pending','Adoption'],groups);
}

export function cohortTable(a:ActivityMetrics,by:Dimension,from:string,to:string,unnamedCategory='Uncategorized') {
  if(from && to && from>to) return `<p>${tr("Choose an end date on or after the start date.")}</p>`;
  const groups = new Map<string,Map<string,number>>(), totals=new Map<string,number>();
  for (const item of a.intake) {
    if ((from && item.day<from) || (to && item.day>to)) continue;
    const key=item[by];
    const counts=groups.get(key) ?? new Map<string,number>();
    counts.set(item.outcome,(counts.get(item.outcome) ?? 0)+item.n);
    groups.set(key,counts);
    totals.set(item.outcome,(totals.get(item.outcome) ?? 0)+item.n);
  }
  if (!groups.size) return `<p class="muted">${tr("No recorded creations or placements in this selection.")}</p>`;
  const placed=(counts:Map<string,number>)=>[...counts].reduce((sum,[key,n])=>key==='Created'?sum:sum+n,0);
  const all=placed(totals);
  const row=(label:string,counts:Map<string,number>)=>{
    const n=placed(counts),done=counts.get('Completed') ?? 0;
    const cells=[label,counts.get('Created') ?? 0,n,rate(n,all),done,counts.get('On board') ?? 0,counts.get('Removed') ?? 0];
    if(totals.has('Unknown')) cells.push(counts.get('Unknown') ?? 0);
    return [...cells,rate(done,n)];
  };
  const names:Record<string,string>=by==='library'?{daily:'Everyday',temporary:'One-off'}:by==='priority'?priorityNames:{};
  const rows=[...groups].sort(([a,x],[b,y])=>by==='day'?b.localeCompare(a):placed(y)-placed(x)||a.localeCompare(b))
    .map(([key,counts])=>row(Object.hasOwn(names,key)?tr(names[key]):by==='category' && key==='Uncategorized'?unnamedCategory:key,counts));
  return table([by[0].toUpperCase()+by.slice(1),'Created','Placed','Placement share','Completed','On board','Removed',
    ...(totals.has('Unknown')?['Unknown']:[]),'Completion rate'],[row(tr('Total'),totals),...rows]);
}

export function refreshCohort(panel:HTMLElement,a:ActivityMetrics) {
  const by=panel.querySelector<HTMLSelectElement>('[name="group"]')!.value as Dimension;
  const dates=panel.querySelectorAll<HTMLInputElement>('input[type="date"]');
  panel.querySelector('[data-cohort-results]')!.innerHTML=cohortTable(a,by,dates[0].value,dates[1].value,panel.dataset.unnamedCategory);
}

function heatmap(size:number,counts:number[],label:string) {
  const max=counts.reduce((a,b)=>Math.max(a,b),1);
  return `<figure><figcaption>${tr(label)}</figcaption><div class="heat-grid" style="--side:${size}">${counts.map((n,i)=>
    `<span style="--shade:${Math.round(92-40*n/max)}%" title="${tr('Row {0}, column {1}: {2}',Math.floor(i/size)+1,i%size+1,n)}">${n}</span>`).join('')}</div></figure>`;
}
function lineName(size:number,cells:number[]) {
  const [a,b]=cells;
  if (Math.floor(a/size)===Math.floor(b/size)) return tr('Row {0}',Math.floor(a/size)+1);
  if (a%size===b%size) return tr('Column {0}',a%size+1);
  return tr(a===0?'Diagonal ↘':'Diagonal ↙');
}
function locations(a:ActivityMetrics) {
  const sizes=[...new Set([...a.squares,...a.lines].map(v=>v.size))].filter(n=>Number.isInteger(n)&&n>=2&&n<=12).sort((x,y)=>x-y);
  if(!sizes.length) return `<p class="muted">${tr("No recorded draws or Bingo lines on these days.")}</p>`;
  return sizes.map(size=>{
    const first=Array<number>(size*size).fill(0),all=first.slice();
    for (const s of a.squares.filter(s=>s.size===size)) {
      if(s.square>=0 && s.square<all.length){first[s.square]=s.first;all[s.square]=s.all;}
    }
    const lines=a.lines.filter(l=>l.size===size);
    return `<section><h3>${tr('{0} × {0} board',size)}</h3><div class="heat-pair">${heatmap(size,first,'First draws')}${heatmap(size,all,'All draws')}</div>
      ${lines.length?table(['Bingo line','Rounds with this line'],lines.map(l=>[lineName(size,l.cells),l.n])):`<p class="muted">${tr("No recorded Bingo lines at this size.")}</p>`}</section>`;
  }).join('');
}
export function gapText(gap:string) {
  if(gap==='Unrecorded') return tr('Distance unrecorded');
  if(gap==='No playable task') return tr(gap);
  if(language==='zh-CN') return tr('Remaining task count',gap);
  return gap+' more task'+(gap==='1'?'':'s')+' needed';
}
export function activityHistory(a:ActivityMetrics,unnamedCategory:string) {
  const gaps=new Map<string,number>();
  for(const g of a.gaps) gaps.set(g.label,(gaps.get(g.label)??0)+1);
  const gapRows=[...gaps].sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true})).map(([k,v])=>[gapText(k),v]);
  return `<section class="panel report"><div class="metric-caption"><h2>${tr("First-draw adoption")}</h2>${metricHint('adoption')}</div>
    <p class="muted">${tr("How often was the first suggestion the next task you completed, before drawing again or ending the round? Pending draws stay out of the percentage.")}</p>
    ${adoptionReport(a)}</section>
    <details class="panel report" data-cohort data-unnamed-category="${esc(unnamedCategory)}"><summary>${tr("Tasks created, placed and completed")}</summary>
    <p class="muted">${tr("Choose when tasks were created or placed.")}${metricHint('intake')} ${tr('Each placement counts once, even across rounds. Outcomes are current as of {0}.',dateKey(new Date()))}${metricHint('rate')}</p>
    <div class="cohort-controls"><label>${tr("From")}<input type="date" name="from"></label><label>${tr("Through")}<input type="date" name="to"></label>
    <label>${tr("Group by")}<select name="group"><option value="category">${tr("Category")}</option><option value="library">${tr("Library")}</option><option value="priority">${tr("Priority")}</option><option value="day">${tr("Board day")}</option></select></label></div>
    <div data-cohort-results>${cohortTable(a,'category','','',unnamedCategory)}</div></details>
    <details class="panel report"><summary>${tr("Distance at early stop")}</summary>
    <p class="muted">${tr("The fewest additional tasks needed to reach the goal on the layout at closing.")}${metricHint('gap')}</p>
    ${gapRows.length?table(['Remaining work','Early-stop rounds'],gapRows):`<p class="muted">${tr("No early stops on these days.")}</p>`}</details>
    <details class="panel report"><summary>${tr("Draws, shuffles and Bingo lines")}</summary>
    <p class="muted">${tr("Counts reflect which squares held eligible tasks. Each line counts once per round, even if a shuffle brings it back.")}${metricHint('layout')}</p>${locations(a)}
    <h3>${tr("When you draw or shuffle")}</h3><p class="muted">${tr("A redraw is another draw before completing a task.")}${metricHint('redraw')}</p>
    ${a.timing.length?table(['Squares completed','All draws','Redraws','Shuffles'],a.timing.map(v=>[v.completed,v.draws,v.redraws,v.shuffles])):`<p class="muted">${tr("No recorded draws or shuffles on these days.")}</p>`}</details>
    <p class="muted">${tr("Activity reports use recorded events. Older saves may have completion history without draw or placement records.")}</p>`;
}
