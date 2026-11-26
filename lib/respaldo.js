// Respaldos (7.6.10): copia diaria de la base, cifrada con AES-256-GCM, con retención y prueba de restauración.
// Consola:
//   node --env-file-if-exists=.env lib/respaldo.js ahora
//   node --env-file-if-exists=.env lib/respaldo.js verificar <archivo>
//   node --env-file-if-exists=.env lib/respaldo.js restaurar <archivo> [destino]   (con el servidor detenido)
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAGIA = Buffer.from('TRZ1');
export const dirRespaldos = () => resolve(process.env.TRAZA_RESPALDOS || join(RAIZ, 'data', 'respaldos'));
export const retencion = () => Number(process.env.TRAZA_RESPALDO_DIAS || 30);
const clave = () => process.env.TRAZA_RESPALDO_CLAVE || '';

function cifrar(buf, pass) {
  const sal = randomBytes(16), iv = randomBytes(12);
  const k = scryptSync(pass, sal, 32, { N: 16384, r: 8, p: 1 });
  const c = createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIA, sal, iv, c.getAuthTag(), datos]);
}
function descifrar(buf, pass) {
  if (!buf.subarray(0, 4).equals(MAGIA)) throw new Error('El archivo no es un respaldo cifrado de Traza OMIL');
  if (!pass) throw new Error('Falta TRAZA_RESPALDO_CLAVE para descifrar');
  const sal = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48);
  const k = scryptSync(pass, sal, 32, { N: 16384, r: 8, p: 1 });
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new Error('Clave incorrecta o respaldo alterado'); }
}

/** Crea un respaldo consistente (VACUUM INTO) de la base abierta. */
export function respaldar(db, { motivo = 'programado' } = {}) {
  const dir = dirRespaldos();
  mkdirSync(dir, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmp = join(tmpdir(), `traza-${marca}-${randomBytes(4).toString('hex')}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const crudo = readFileSync(tmp);
  rmSync(tmp, { force: true });
  const pass = clave();
  const nombre = `traza-${marca}${pass ? '.db.enc' : '.db'}`;
  writeFileSync(join(dir, nombre), pass ? cifrar(crudo, pass) : crudo, { mode: 0o600 });
  podar();
  return { archivo: nombre, bytes: crudo.length, cifrado: !!pass, motivo };
}

export function listarRespaldos() {
  const dir = dirRespaldos();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^traza-.*\.db(\.enc)?$/.test(f)).sort().reverse()
    .map((f) => ({ archivo: f, bytes: statSync(join(dir, f)).size, fecha: statSync(join(dir, f)).mtime.toISOString(), cifrado: f.endsWith('.enc') }));
}
function podar() {
  for (const r of listarRespaldos().slice(retencion())) rmSync(join(dirRespaldos(), r.archivo), { force: true });
}

/** ¿Toca respaldar? Una vez al día, a partir de la hora configurada (por defecto 02:00). */
export function respaldoPendiente() {
  const hora = Number(process.env.TRAZA_RESPALDO_HORA ?? 2);
  const ahora = new Date();
  if (ahora.getHours() < hora) return false;
  const hoy = ahora.toISOString().slice(0, 10);
  return !listarRespaldos().some((r) => r.fecha.slice(0, 10) === hoy);
}

/** Restaura un respaldo en un archivo temporal y comprueba que la base esté íntegra (prueba de restauración). */
export function verificarRespaldo(archivo) {
  const ruta = archivo.includes('/') ? archivo : join(dirRespaldos(), archivo);
  const buf = readFileSync(ruta);
  const crudo = buf.subarray(0, 4).equals(MAGIA) ? descifrar(buf, clave()) : buf;
  const tmp = join(tmpdir(), `traza-verif-${randomBytes(4).toString('hex')}.db`);
  writeFileSync(tmp, crudo);
  try {
    const d = new DatabaseSync(tmp, { readOnly: true });
    const integ = d.prepare('PRAGMA integrity_check').get();
    const cuenta = (t) => d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const res = { ok: Object.values(integ)[0] === 'ok', ofertas: cuenta('ofertas'), postulaciones: cuenta('postulaciones'), avisos: cuenta('avisos'), bitacora: cuenta('bitacora') };
    d.close();
    return res;
  } finally { rmSync(tmp, { force: true }); }
}

export function restaurar(archivo, destino = join(RAIZ, 'data', 'traza.db')) {
  const ruta = archivo.includes('/') ? archivo : join(dirRespaldos(), archivo);
  const v = verificarRespaldo(ruta);
  if (!v.ok) throw new Error('El respaldo no pasó la verificación de integridad');
  const buf = readFileSync(ruta);
  const crudo = buf.subarray(0, 4).equals(MAGIA) ? descifrar(buf, clave()) : buf;
  if (existsSync(destino)) copyFileSync(destino, `${destino}.antes-de-restaurar-${Date.now()}`);
  for (const ext of ['-wal', '-shm']) rmSync(destino + ext, { force: true });
  writeFileSync(destino, crudo, { mode: 0o600 });
  return { destino, ...v };
}

// ---------- consola ----------
if (process.argv[1] && basename(process.argv[1]) === 'respaldo.js') {
  const [cmd, archivo, destino] = process.argv.slice(2);
  try {
    if (cmd === 'ahora') {
      const db = new DatabaseSync(process.env.TRAZA_DB || join(RAIZ, 'data', 'traza.db'));
      console.log(respaldar(db, { motivo: 'consola' }));
    } else if (cmd === 'verificar' && archivo) console.log(verificarRespaldo(archivo));
    else if (cmd === 'restaurar' && archivo) console.log(restaurar(archivo, destino));
    else if (cmd === 'listar') console.table(listarRespaldos());
    else console.log('Uso: ahora | listar | verificar <archivo> | restaurar <archivo> [destino]');
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}
