import { tr, language } from './i18n.ts';
import { esc } from './copy.ts';
import { metricHint } from './metric-hints.ts';
import { activityHistory, gapText } from './activity-history.ts';
import { boardCategories, type Board } from './rules.ts';
import type { BoardMetrics, DayFilter } from './metrics.ts';

export function history(b:Board,m:BoardMetrics,filter:DayFilter,ascending:boolean) {
  // Older SQL views use this label both for an empty category and for a literal user category.
  const unnamedCategory = language === 'zh-CN' && !boardCategories(b).includes('Uncategorized') ? tr('Uncategorized') : 'Uncategorized';
  const categoryName = (name:string) => name === 'Uncategorized' ? unnamedCategory : name;
  const closed=m.rounds.filter(r=>!r.open);
  const peak=closed.reduce((largest,r)=>Math.max(largest,r.count),1);
  const categoryPeak=m.byCategory[0]?.n || 1;
  const byCategory=ascending ? [...m.byCategory].reverse() : m.byCategory;
  const value=(v:number|null)=>v===null?'—':v.toLocaleString('en-US',{maximumFractionDigits:1});
  const modes=m.modes.length===closed.length && closed.length>1?tr('No repeated count'):m.modes.join(', ') || '—';
  const breakdown=(label:string,key:'priority'|'library',groups:{name:string;n:number}[],names:Record<string,string>)=>
    `<section><div class="metric-caption"><h3>${tr(label)}</h3>${metricHint(key)}</div><table><thead><tr><th>${tr("Type")}</th><th>${tr("Completed")}</th><th>${tr("Share")}</th></tr></thead><tbody>${
      Object.entries(names).map(([key,name])=>{
        const n=groups.find(g=>g.name===key)?.n ?? 0;
        return `<tr><td>${tr(name)}</td><td>${n}</td><td>${m.total?(100*n/m.total).toLocaleString('en-US',{maximumFractionDigits:1})+'%':'—'}</td></tr>`;
      }).join('')}</tbody></table></section>`;
  const dayRounds=new Map<string, typeof m.rounds>();
  for(const r of m.rounds){if(!dayRounds.has(r.day))dayRounds.set(r.day,[]);dayRounds.get(r.day)!.push(r);}
  return `<div class="history-view stack">
    <p class="muted">${tr("Hover over a question mark, tap it, or use Tab to focus it for tips on reading your stats and ideas for what to try next.")}</p>
    <div class="history-toolbar"><label>${tr("Show days")}<select id="history-filter">${Object.entries({All:'All days',Success:'Successful days',Unfinished:'Unfinished days'}).map(([v,label])=>`<option value="${v}" ${filter===v?'selected':''}>${tr(label)}</option>`).join('')}</select></label>
    </div>
    <div class="layout"><section class="panel"><div class="sectiontop"><h2>${tr("Task completions")}</h2><span class="pill">${tr('{0} total',m.total)}</span></div>
    <div class="metric-totals"><div><strong>${m.total}</strong>${tr("Tasks completed")}${metricHint('total')}</div><div><strong>${m.rounds.length}</strong>${tr("Rounds started")}</div></div>
    ${m.total?`<div class="sectiontop sectiongap"><div class="metric-caption"><h3>${tr("Completions by category")}</h3>${metricHint('category')}</div><select id="category-order" aria-label="${tr("Category sort order")}"><option value="desc">${tr("Most first")}</option><option value="asc" ${ascending?'selected':''}>${tr("Fewest first")}</option></select></div>
    <ul class="category-bars">${byCategory.map(g=>`<li><span>${esc(categoryName(g.name))}</span><meter min="0" max="${categoryPeak}" value="${g.n}" aria-label="${esc(tr('{0} completions',categoryName(g.name)))}"></meter><b>${g.n}</b></li>`).join('')}</ul>
    <div class="metric-tables sectiongap">${breakdown('By library','library',m.byLibrary,{daily:'Everyday',temporary:'One-off'})}${breakdown('By priority','priority',m.byPriority,{X:'Must-do',Standard:'Standard',Low:'Low'})}</div>
    <details class="sectiongap"><summary>${tr("Counts by task")}</summary>${metricHint('tasks')}<ul class="textlist">${m.tasks.map(t=>`<li><span>${esc(t.name)}</span><b>${t.n}</b></li>`).join('')}</ul></details>
    <details class="sectiongap"><summary>${tr("Completion log")}</summary>${metricHint('log')}<ul class="textlist">${m.log.map(e=>`<li><span>${esc(e.title)}<br><small>${esc(new Date(e.at).toLocaleString(language==='en'?undefined:language))} · ${tr('{0} min planned',e.minutes)}</small></span><b>+${e.points}</b></li>`).join('')}</ul></details>`:`<p class="muted">${tr("No completed tasks for these days yet.")}</p>`}</section>
    <aside class="panel history-days"><div class="metric-caption"><h2>${tr("Round days")}</h2>${metricHint('days')}</div><p class="muted">${esc(tr('A day starts at {0}, local time.',b.dayStart))}</p><p class="sectiongap">${tr('Unfinished days: {0}',m.days.filter(d=>d.status==='Unfinished').length)}</p>
    ${m.days.map(d=>`<details class="history-day"><summary><span>${esc(d.day)}</span> · <b>${esc(tr(d.status))}</b><br><small>${tr('{0} round(s) · {1} completed',d.n,d.count)}</small></summary>
    <ul class="textlist">${dayRounds.get(d.day)!.map(r=>`<li><span>${esc(new Date(r.start).toLocaleTimeString(language==='en'?[]:language,{hour:'2-digit',minute:'2-digit'}))}<br><small>${tr(r.open?'Open':r.success?'Goal reached':'Ended early')}${r.gap?' · '+esc(gapText(r.gap)):''}</small></span><b>${r.count}</b></li>`).join('')}</ul></details>`).join('')}</aside></div>
    <section class="panel"><div class="sectiontop"><div class="metric-caption" data-round-heading><h2>${tr("Tasks per finished round")}</h2>${metricHint('pace')}</div>
    <h2 hidden data-calendar-heading>${tr("Daily activity")}</h2><select id="activity-chart" aria-label="${tr("Activity chart")}"><option value="rounds">${tr("Per-round bars")}</option><option value="calendar">${tr("Daily calendar")}</option></select></div>
    <div data-round-chart>${closed.length?`<p class="muted">${tr('Oldest to newest · Average {0} · Median {1} · Mode: {2}',value(m.mean),value(m.median),modes)}</p>
    <div class="round-bars">${closed.map((r,i)=>`<div title="${esc(r.day)} · ${tr("{0} completed",r.count)}" aria-label="${esc(tr('Round {0}, {1}, {2} completed',i+1,r.day,r.count))}"><b>${r.count}</b><i style="height:${Math.round(65*r.count/peak)}px"></i><small>${i+1}</small></div>`).join('')}</div>`:`<p class="muted">${tr("Finish a round to see its completion count here.")}</p>`}
    </div><div data-calendar-chart hidden></div>
    <p class="muted sectiongap">${tr('Median time from round start to first completion: {0} ({1} measured). Rounds without a completion: {2}.',m.activity.latency.medianMinutes===null?'—':tr('{0} min',value(m.activity.latency.medianMinutes)),m.activity.latency.observed,m.activity.latency.noFinish)}${metricHint('latency')}</p></section>${activityHistory(m.activity,unnamedCategory)}</div>`;
}
