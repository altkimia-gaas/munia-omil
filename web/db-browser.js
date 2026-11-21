// Sustituto de lib/db.js para la demo en el navegador: misma API (q, tx, getDb) sobre sql.js (SQLite en WebAssembly).
import { SCHEMA } from '../lib/schema.js';

let SQL = null;
let db = null;

export function useSqlJs(sqlModule) { SQL = sqlModule; }

export function openDb(bytes = null) {
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.exec(SCHEMA);
  return db;
}
export function getDb() { return db; }
export function exportDb() { return db.export(); }

const n = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
function all(sql, params) {
  const st = db.prepare(sql);
  try {
    st.bind(n(params));
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally { st.free(); }
}
export const q = {
  get: (sql, ...p) => all(sql, p)[0],
  all: (sql, ...p) => all(sql, p),
  run: (sql, ...p) => {
    db.run(sql, n(p));
    const changes = db.getRowsModified();
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { changes, lastInsertRowid: id };
  },
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
