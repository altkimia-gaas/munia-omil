// Base de datos: SQLite integrado de Node (node:sqlite). Modelo de datos de la sección 8.1.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA } from './schema.js';
export { SCHEMA };



let db;

// Migraciones de bases creadas con versiones anteriores.
const COLUMNAS_NUEVAS = {
  usuarios: ['clave_hash TEXT', 'totp_secreto TEXT', 'totp_activo INTEGER NOT NULL DEFAULT 0', 'totp_ultimo_paso INTEGER',
    'intentos_fallidos INTEGER NOT NULL DEFAULT 0', 'bloqueado_hasta TEXT', 'activacion_hash TEXT', 'activacion_vence TEXT', 'ultimo_acceso TEXT'],
  declaraciones: ['verificacion TEXT', 'sello TEXT'],
};
function migrar(d) {
  for (const [tabla, cols] of Object.entries(COLUMNAS_NUEVAS)) {
    const existe = d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(tabla);
    if (!existe) continue;
    const tiene = new Set(d.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
    for (const c of cols) if (!tiene.has(c.split(' ')[0])) d.exec(`ALTER TABLE ${tabla} ADD COLUMN ${c}`);
  }
  const avisos = d.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='avisos'`).get();
  if (avisos && !avisos.sql.includes("'pendiente'")) {
    // v0.2: cola de correo real (nuevos estados y columnas de reintento)
    d.exec(`BEGIN;
      ALTER TABLE avisos RENAME TO avisos_v1;
      DROP INDEX IF EXISTS ix_avisos_oferta;`);
    d.exec(SCHEMA.slice(SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS avisos'), SCHEMA.indexOf(');', SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS avisos')) + 2));
    d.exec(`INSERT INTO avisos(id, tipo, postulacion_id, empleador_id, oferta_id, usuario_id, destinatario, plantilla_version, asunto, cuerpo, enviado_at, estado_entrega, entregado_at)
        SELECT id, tipo, postulacion_id, empleador_id, oferta_id, usuario_id, destinatario, plantilla_version, asunto, cuerpo, enviado_at, estado_entrega,
          CASE WHEN estado_entrega='entregado' THEN enviado_at END FROM avisos_v1;
      DROP TABLE avisos_v1;
      COMMIT;`);
  }
}

export function openDb(file = process.env.TRAZA_DB || 'data/traza.db') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  migrar(db);
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
