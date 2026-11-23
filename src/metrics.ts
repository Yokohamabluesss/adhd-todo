import type { SqlJsStatic } from 'sql.js';
import { activityMetrics } from './activity-metrics.ts';

export type DayFilter = 'All' | 'Success' | 'Unfinished';
export const metricViews = `
  CREATE VIEW IF NOT EXISTS day_metrics AS
    SELECT board, day, CASE WHEN MAX(success)=1 THEN 'Success'
      WHEN MAX(end IS NULL)=1 THEN 'In progress' ELSE 'Unfinished' END AS day_status
    FROM rounds GROUP BY board, day;
  CREATE VIEW IF NOT EXISTS round_metrics AS
    SELECT r.board,r.id,r.day,r.start,r.end,r.success,d.day_status,COUNT(c.round) AS completed
    FROM rounds r JOIN day_metrics d USING(board,day)
    LEFT JOIN completions c ON c.board=r.board AND c.round=r.id
    GROUP BY r.board,r.id;
  CREATE VIEW IF NOT EXISTS completion_metrics AS
    SELECT c.board,c.round,c.source,c.title,c.at,c.minutes,c.points,r.day,d.day_status,
      COALESCE(NULLIF(TRIM(json_extract(c.attributes,'$.category')),''),'Uncategorized') AS category,
      json_extract(c.attributes,'$.library') AS library,json_extract(c.attributes,'$.priority') AS priority,
      json_extract(c.attributes,'$.placement') AS placement
    FROM completions c JOIN rounds r ON r.board=c.board AND r.id=c.round
    JOIN day_metrics d ON d.board=r.board AND d.day=r.day;`;

export function readMetrics(SQL: SqlJsStatic,bytes: Uint8Array,board: string,filter: DayFilter) {
  const db = new SQL.Database(bytes);
  try {
    db.run(metricViews); // Also enables the views on original v1/v2 snapshots in memory.
    db.run('CREATE TEMP TABLE selection(board TEXT, filter TEXT)');
    db.run('INSERT INTO selection VALUES (?,?)',[board,filter]);
    db.run(`CREATE TEMP VIEW selected_rounds AS SELECT r.* FROM round_metrics r JOIN selection s USING(board)
      WHERE s.filter='All' OR r.day_status=s.filter;
      CREATE TEMP VIEW selected_completions AS SELECT c.* FROM completion_metrics c JOIN selection s USING(board)
      WHERE s.filter='All' OR c.day_status=s.filter;`);
    const rows = (query: string) => db.exec(query)[0]?.values ?? [];
    const total = Number(rows('SELECT COUNT(*) FROM selected_completions')[0][0]);
    const groups = (field: 'category'|'library'|'priority') => rows(`SELECT ${field},COUNT(*) n FROM selected_completions
      GROUP BY ${field} ORDER BY n DESC,${field}`).map(([name,n])=>({name:String(name),n:Number(n)}));
    const activity = activityMetrics(db);
    const gapByRound = new Map(activity.gaps.map(g=>[g.id,g.label]));
    const rounds = rows('SELECT id,day,start,end,success,day_status,completed FROM selected_rounds ORDER BY start,id')
      .map(([id,day,start,end,success,status,count])=>({gap:gapByRound.get(String(id)),day:String(day),start:Number(start),open:end===null,
        success:!!success,status:String(status),count:Number(count)}));
    const [mean,median] = rows(`WITH ranked AS (SELECT completed,
      ROW_NUMBER() OVER(ORDER BY completed) AS pos,COUNT(*) OVER() AS n FROM selected_rounds WHERE end IS NOT NULL)
      SELECT AVG(completed),AVG(CASE WHEN pos BETWEEN (n+1)/2 AND (n+2)/2 THEN completed END) FROM ranked`)[0];
    const modes = rows(`WITH freq AS (SELECT completed,COUNT(*) n FROM selected_rounds WHERE end IS NOT NULL GROUP BY completed)
      SELECT completed FROM freq WHERE n=(SELECT MAX(n) FROM freq) ORDER BY completed`).map(row=>Number(row[0]));
    const tasks = rows(`WITH latest AS (SELECT *,COUNT(*) OVER(PARTITION BY source) AS n,
      ROW_NUMBER() OVER(PARTITION BY source ORDER BY at DESC,round DESC,title) AS pos FROM selected_completions)
      SELECT title,n FROM latest WHERE pos=1 ORDER BY n DESC,title`).map(([name,n])=>({name:String(name),n:Number(n)}));
    const days = rows(`SELECT day,day_status,SUM(completed),COUNT(*) FROM selected_rounds
      GROUP BY day,day_status ORDER BY day DESC`).map(([day,status,count,n])=>({day:String(day),status:String(status),count:Number(count),n:Number(n)}));
    const log = rows('SELECT title,at,minutes,points FROM selected_completions ORDER BY at DESC')
      .map(([title,at,minutes,points])=>({title:String(title),at:Number(at),minutes:Number(minutes),points:Number(points)}));
    return {total,activity,byCategory:groups('category'),byLibrary:groups('library'),byPriority:groups('priority'),
      rounds,days,mean:mean===null?null:Number(mean),median:median===null?null:Number(median),modes,tasks,log};
  } finally { db.close(); }
}
export type BoardMetrics = ReturnType<typeof readMetrics>;
