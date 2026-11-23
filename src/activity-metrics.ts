import type { Database } from 'sql.js';

// Keep event order when several actions have the same timestamp. Save/export
// writes each board's events in commit order and restores that order on import.
export const activityViews = `
  CREATE VIEW IF NOT EXISTS draw_sequence AS
    WITH actions AS (
      SELECT board,round,kind,rowid AS seq,
        json_extract(data,'$.placement') AS placement,
        json_extract(data,'$.eligible') AS eligible,
        json_extract(data,'$.size') AS size,json_extract(data,'$.square') AS square,
        json_extract(data,'$.completed') AS completed
      FROM board_events WHERE round IS NOT NULL AND kind IN ('drawn','completed','ended')
    ), neighbors AS (
      SELECT *,LAG(kind) OVER w AS previous_kind, LEAD(kind) OVER w AS next_kind,
        LEAD(placement) OVER w AS next_placement
      FROM actions WINDOW w AS (PARTITION BY board,round ORDER BY seq)
    )
    SELECT *, ROW_NUMBER() OVER (PARTITION BY board,round ORDER BY seq) AS draw_number
    FROM neighbors WHERE kind='drawn';

  CREATE VIEW IF NOT EXISTS first_draw_metrics AS
    SELECT d.board,d.round,d.eligible,
      CASE WHEN d.next_kind='completed' AND d.next_placement=d.placement THEN 'Adopted'
           WHEN d.next_kind IS NULL AND r.end IS NULL THEN 'Pending'
           ELSE 'Not adopted' END AS outcome
    FROM draw_sequence d JOIN rounds r ON r.board=d.board AND r.id=d.round
    WHERE draw_number=1;

  CREATE VIEW IF NOT EXISTS placement_metrics AS
    WITH lifecycle AS (
      SELECT board,json_extract(data,'$.placement') AS placement,
        MAX(kind='completed') AS done, MAX(kind='removed') AS removed
      FROM board_events WHERE kind IN ('completed','removed') GROUP BY board,placement
    ), live AS (
      SELECT b.id AS board,json_extract(cell.value,'$.placement') AS placement
      FROM boards b,json_each(b.layout,'$.cells') cell WHERE cell.type='object'
    )
    SELECT p.board,p.day,json_extract(p.data,'$.placement') AS placement,
      json_extract(p.data,'$.category') AS category,json_extract(p.data,'$.library') AS library,
      json_extract(p.data,'$.priority') AS priority,
      CASE WHEN l.done=1 THEN 'Completed' WHEN l.removed=1 THEN 'Removed'
           WHEN live.placement IS NOT NULL THEN 'On board' ELSE 'Unknown' END AS outcome
    FROM board_events p
    LEFT JOIN lifecycle l ON l.board=p.board AND l.placement=json_extract(p.data,'$.placement')
    LEFT JOIN live ON live.board=p.board AND live.placement=json_extract(p.data,'$.placement')
    WHERE p.kind='placed' AND json_extract(p.data,'$.placement') IS NOT NULL;`;

export function activityMetrics(db: Database) {
  const rows = (sql: string) => db.exec(sql)[0]?.values ?? [];
  // A v1/v2 snapshot has no event table. Reporting reads a private in-memory copy.
  if (!rows("SELECT 1 FROM sqlite_master WHERE type='table' AND name='board_events'").length)
    db.run('CREATE TABLE board_events(board TEXT,kind TEXT,at INTEGER,day TEXT,round TEXT,data TEXT)');
  db.run(activityViews);
  db.run(`CREATE TEMP VIEW selected_events AS
    SELECT e.* FROM board_events e JOIN selection s USING(board)
    LEFT JOIN day_metrics d ON e.board=d.board AND e.day=d.day
    WHERE s.filter='All' OR s.filter=d.day_status;
    CREATE TEMP VIEW selected_draws AS
    SELECT d.* FROM draw_sequence d JOIN selected_rounds r ON d.board=r.board AND d.round=r.id;`);

  const adoption = rows(`SELECT eligible=1,outcome,COUNT(*)
    FROM first_draw_metrics a JOIN selected_rounds r ON a.board=r.board AND a.round=r.id
    GROUP BY eligible=1,outcome`).map(([single,outcome,n])=>({single:!!single,outcome:String(outcome),n:Number(n)}));

  // Filter the intake date only. Later completions, including those on another
  // type of day, still belong to the original placement.
  const intake = rows(`WITH intake AS (
    SELECT p.day,p.category,p.library,p.priority,p.outcome FROM placement_metrics p
    JOIN selection s USING(board) LEFT JOIN day_metrics d ON p.board=d.board AND p.day=d.day
    WHERE s.filter='All' OR s.filter=d.day_status
    UNION ALL
    SELECT day,json_extract(data,'$.category'),json_extract(data,'$.library'),
       json_extract(data,'$.priority'),'Created' FROM selected_events WHERE kind='created'
  ) SELECT day,COALESCE(NULLIF(TRIM(category),''),'Uncategorized'),library,priority,outcome,COUNT(*)
    FROM intake GROUP BY 1,2,3,4,5 ORDER BY day`)
    .map(([day,category,library,priority,outcome,n])=>({day:String(day),category:String(category),
      library:String(library),priority:String(priority),outcome:String(outcome),n:Number(n)}));

  const gaps = rows(`SELECT r.id,json_extract(e.data,'$.remaining'),e.kind
    FROM selected_rounds r LEFT JOIN board_events e ON r.board=e.board AND r.id=e.round AND e.kind='ended'
    WHERE r.end IS NOT NULL AND r.success=0`).map(([id,gap,kind])=>({id:String(id),
      label:kind===null?'Unrecorded':gap===null?'No playable task':String(gap)}));
  const [medianMs,observed,noFinish] = rows(`WITH firsts AS (
    SELECT r.id, MIN(c.at)-r.start AS elapsed FROM selected_rounds r
    LEFT JOIN completions c ON r.board=c.board AND r.id=c.round GROUP BY r.id
  ), ranked AS (
    SELECT elapsed,ROW_NUMBER() OVER(ORDER BY elapsed) pos,COUNT(*) OVER() n
    FROM firsts WHERE elapsed>=0
  ) SELECT AVG(CASE WHEN pos BETWEEN (n+1)/2 AND (n+2)/2 THEN elapsed END),COUNT(*),
    (SELECT COUNT(*) FROM firsts WHERE elapsed IS NULL) FROM ranked`)[0];
  const latency = {medianMinutes:medianMs===null?null:Number(medianMs)/60000,observed:Number(observed),noFinish:Number(noFinish)};

  const squares = rows(`SELECT size,square,SUM(draw_number=1),COUNT(*) FROM selected_draws
    GROUP BY size,square ORDER BY size,square`).map(([size,square,first,all])=>({
      size:Number(size),square:Number(square),first:Number(first),all:Number(all)}));
  const timing = rows(`WITH actions AS (
    SELECT completed, 'Draw' AS kind,previous_kind='drawn' AS redraw FROM selected_draws
    UNION ALL SELECT json_extract(data,'$.completed'),'Shuffle',0 FROM selected_events WHERE kind='shuffled'
  ) SELECT completed,SUM(kind='Draw'),SUM(COALESCE(redraw,0)),SUM(kind='Shuffle')
    FROM actions GROUP BY completed ORDER BY completed`)
    .map(([completed,draws,redraws,shuffles])=>({completed:Number(completed),draws:Number(draws),
      redraws:Number(redraws),shuffles:Number(shuffles)}));

  // A line can remain lit through many completions and can reappear after a shuffle.
  const lines = rows(`WITH RECURSIVE split(round,size,line,rest) AS (
    SELECT round,json_extract(data,'$.size'),'',json_extract(data,'$.lines') || '|'
    FROM selected_events WHERE kind IN ('completed','shuffled') AND json_extract(data,'$.lines')!=''
    UNION ALL SELECT round,size,substr(rest,1,instr(rest,'|')-1),substr(rest,instr(rest,'|')+1)
    FROM split WHERE rest!=''
  ) SELECT size,line,COUNT(DISTINCT round) FROM split WHERE line!=''
    GROUP BY size,line ORDER BY size,3 DESC,line`)
    .map(([size,line,n])=>({size:Number(size),cells:String(line).split(',').map(Number),n:Number(n)}));
  return {adoption,intake,gaps,latency,squares,timing,lines};
}
export type ActivityMetrics = ReturnType<typeof activityMetrics>;
