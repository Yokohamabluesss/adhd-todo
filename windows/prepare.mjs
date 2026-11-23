// Ship the web codec's actual SQLite schema and reporting views with the local service.
import { mkdir, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { encode } from '../src/archive.ts';

const SQL = await initSqlJs();
const db = new SQL.Database(encode(SQL, {boards: [], defaultId: ''}));
try {
  const statements = db.exec("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid")[0].values;
  const output = new URL('./.build/', import.meta.url);
  await mkdir(output, {recursive:true});
  await writeFile(new URL('schema.sql', output), statements.map(([sql])=>sql+';').join('\n')+'\n');
} finally { db.close(); }
