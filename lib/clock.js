// Reloj del sistema y calendario de días hábiles (RN-15).
// El reloj admite un desfase simulado para probar temporizadores (prueba 9.7 "reloj simulado").
import { q } from './db.js';

const DAY = 86400000;

export function offsetDays() {
  const r = q.get(`SELECT valor FROM ajustes WHERE clave='reloj_desfase_dias'`);
  return r ? Number(r.valor) : 0;
}
export function setOffsetDays(n) {
  q.run(`INSERT INTO ajustes(clave, valor) VALUES('reloj_desfase_dias', ?)
         ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor`, String(n));
}

export function now() {
  return new Date(Date.now() + offsetDays() * DAY);
}
export function nowIso() {
  return now().toISOString();
}

// Fechas "de calendario" en hora local (America/Santiago en el servidor municipal)
export function toDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function today() {
  return toDate(now());
}
function parse(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(dateStr, n) {
  const d = parse(dateStr);
  d.setDate(d.getDate() + n);
  return toDate(d);
}

let feriadosCache = null;
export function invalidateFeriados() { feriadosCache = null; }
function feriados() {
  if (!feriadosCache) feriadosCache = new Set(q.all('SELECT fecha FROM feriados').map((r) => r.fecha));
  return feriadosCache;
}

export function isBusinessDay(dateStr) {
  const wd = parse(dateStr).getDay();
  return wd !== 0 && wd !== 6 && !feriados().has(dateStr);
}
export function addBusinessDays(dateStr, n) {
  let d = dateStr;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}
export function nextBusinessDay(dateStr) {
  return addBusinessDays(dateStr, 1);
}
/** Días hábiles transcurridos desde `from` (exclusivo) hasta `to` (inclusivo). */
export function businessDaysBetween(from, to) {
  let n = 0;
  let d = from;
  while (d < to) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) n++;
  }
  return n;
}
/** Días corridos entre dos fechas (YYYY-MM-DD). */
export function calendarDaysBetween(from, to) {
  return Math.round((parse(to) - parse(from)) / DAY);
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const s = dateStr.length > 10 ? toDate(dateStr) : dateStr;
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtDate(toDate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Feriados nacionales de Chile (parametrizables desde Administración; verificar cada año)
export const FERIADOS_BASE = [
  ['2026-01-01', 'Año Nuevo'], ['2026-04-03', 'Viernes Santo'], ['2026-04-04', 'Sábado Santo'],
  ['2026-05-01', 'Día del Trabajo'], ['2026-05-21', 'Día de las Glorias Navales'],
  ['2026-06-21', 'Día de los Pueblos Indígenas'], ['2026-06-29', 'San Pedro y San Pablo'],
  ['2026-07-16', 'Virgen del Carmen'], ['2026-08-15', 'Asunción de la Virgen'],
  ['2026-09-18', 'Independencia Nacional'], ['2026-09-19', 'Glorias del Ejército'],
  ['2026-10-12', 'Encuentro de Dos Mundos'], ['2026-10-31', 'Iglesias Evangélicas'],
  ['2026-11-01', 'Todos los Santos'], ['2026-12-08', 'Inmaculada Concepción'], ['2026-12-25', 'Navidad'],
  ['2027-01-01', 'Año Nuevo'], ['2027-03-26', 'Viernes Santo'], ['2027-03-27', 'Sábado Santo'],
  ['2027-05-01', 'Día del Trabajo'], ['2027-05-21', 'Día de las Glorias Navales'],
  ['2027-06-21', 'Día de los Pueblos Indígenas'], ['2027-06-28', 'San Pedro y San Pablo'],
  ['2027-07-16', 'Virgen del Carmen'], ['2027-08-15', 'Asunción de la Virgen'],
  ['2027-09-17', 'Feriado adicional Fiestas Patrias'], ['2027-09-18', 'Independencia Nacional'],
  ['2027-09-19', 'Glorias del Ejército'], ['2027-10-11', 'Encuentro de Dos Mundos'],
  ['2027-10-31', 'Iglesias Evangélicas'], ['2027-11-01', 'Todos los Santos'],
  ['2027-12-08', 'Inmaculada Concepción'], ['2027-12-25', 'Navidad'],
];
