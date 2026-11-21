// Bitácora inalterable y encadenada (M9, requisito 7.6.7).
// Cada evento guarda la huella SHA-256 del evento previo; los triggers impiden UPDATE/DELETE.
import { createHash } from 'node:crypto';
import { q } from './db.js';
import { nowIso } from './clock.js';

const GENESIS = '0'.repeat(64);

function hashEvent(e) {
  const payload = JSON.stringify([e.fecha, e.usuario, e.entidad, e.entidad_id, e.oferta_id, e.accion,
    e.valor_anterior, e.valor_nuevo, e.huella_prev]);
  return createHash('sha256').update(payload).digest('hex');
}

const s = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function log({ usuario = 'sistema', entidad, entidad_id = null, oferta_id = null, accion, antes = null, despues = null }) {
  const prev = q.get('SELECT huella FROM bitacora ORDER BY id DESC LIMIT 1');
  const e = {
    fecha: nowIso(), usuario, entidad, entidad_id, oferta_id, accion,
    valor_anterior: s(antes), valor_nuevo: s(despues), huella_prev: prev ? prev.huella : GENESIS,
  };
  e.huella = hashEvent(e);
  q.run(`INSERT INTO bitacora(fecha, usuario, entidad, entidad_id, oferta_id, accion, valor_anterior, valor_nuevo, huella_prev, huella)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
  e.fecha, e.usuario, e.entidad, e.entidad_id, e.oferta_id, e.accion, e.valor_anterior, e.valor_nuevo, e.huella_prev, e.huella);
}

/** Verifica la cadena completa. Devuelve { ok, total, rotoEn }. */
export function verifyChain() {
  const rows = q.all('SELECT * FROM bitacora ORDER BY id');
  let prev = GENESIS;
  for (const r of rows) {
    if (r.huella_prev !== prev || hashEvent(r) !== r.huella) return { ok: false, total: rows.length, rotoEn: r.id };
    prev = r.huella;
  }
  return { ok: true, total: rows.length, rotoEn: null };
}
