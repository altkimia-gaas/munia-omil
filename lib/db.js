// Base de datos: SQLite integrado de Node (node:sqlite). Modelo de datos de la sección 8.1.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA } from './schema.js';
export { SCHEMA };



let db;

export function openDb(file = process.env.TRAZA_DB || 'data/traza.db') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) openDb();
  return db;
}

// Atajos
const n = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
export const q = {
  get: (sql, ...p) => getDb().prepare(sql).get(...n(p)),
  all: (sql, ...p) => getDb().prepare(sql).all(...n(p)),
  run: (sql, ...p) => getDb().prepare(sql).run(...n(p)),
};

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}
