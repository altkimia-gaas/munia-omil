// Acceso de funcionarios (7.6.8 y 8.3): contraseña con scrypt, doble factor TOTP (RFC 6238, compatible con
// Google/Microsoft Authenticator), activación y restablecimiento por enlace de un solo uso, bloqueo por intentos.
import { scryptSync, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';
import { nowIso } from './clock.js';
import { log } from './audit.js';
import { send } from './notify.js';

export const POLITICA = { largoMin: 12, intentosMax: 5, bloqueoMin: 15, sesionHoras: 8, activacionHoras: 72 };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ahoraMs = () => Date.parse(nowIso());
const enMin = (min) => new Date(ahoraMs() + min * 60_000).toISOString();
const quien = (u) => `${u.nombre} (${u.rol})`;

export class AccesoError extends Error {}

// ---------- contraseñas ----------
export function hashClave(clave) {
  const sal = randomBytes(16);
  const h = scryptSync(clave, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${sal.toString('base64')}$${h.toString('base64')}`;
}
export function verificarClave(clave, guardado) {
  if (!guardado) return false;
  const [alg, n, sal, h] = guardado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(h, 'base64');
  const calc = scryptSync(clave, Buffer.from(sal, 'base64'), esperado.length, { N: Number(n), r: 8, p: 1 });
  return timingSafeEqual(calc, esperado);
}
export function problemasClave(clave, u) {
  const p = [];
  if (!clave || clave.length < POLITICA.largoMin) p.push(`al menos ${POLITICA.largoMin} caracteres`);
  if (clave && !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave)) p.push('alguna letra');
  if (clave && !/\d/.test(clave)) p.push('algún número');
  if (u && clave && clave.toLowerCase().includes(u.correo.split('@')[0].toLowerCase())) p.push('no contener su nombre de usuario');
  return p;
}

// ---------- TOTP ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function desdeBase32(s) {
  const limpio = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0, val = 0;
  const out = [];
  for (const ch of limpio) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const nuevoSecretoTotp = () => base32(randomBytes(20));
export function codigoTotp(secreto, paso) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', desdeBase32(secreto)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
export const pasoActual = () => Math.floor(Date.now() / 30_000); // hora real: el reloj simulado no afecta al doble factor
/** Devuelve el paso aceptado (±1 de tolerancia) o null. Rechaza pasos ya usados. */
export function verificarTotp(secreto, codigo, ultimoPaso = null) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const p = pasoActual();
  for (const paso of [p - 1, p, p + 1]) {
    if (ultimoPaso != null && paso <= ultimoPaso) continue;
    if (timingSafeEqual(Buffer.from(codigoTotp(secreto, paso)), Buffer.from(c))) return paso;
  }
  return null;
}
export const otpauthUri = (correo, secreto) =>
  `otpauth://totp/${encodeURIComponent(`Traza OMIL:${correo}`)}?secret=${secreto}&issuer=${encodeURIComponent('Traza OMIL')}&algorithm=SHA1&digits=6&period=30`;
export const secretoLegible = (s) => s.match(/.{1,4}/g).join(' ');

// ---------- usuarios ----------
export const usuarioPorCorreo = (correo) => q.get('SELECT * FROM usuarios WHERE lower(correo)=lower(?)', String(correo || '').trim());

/** Crea o renueva el enlace de activación/restablecimiento y lo envía por correo. Devuelve el enlace (solo para mostrarlo en modo simulado). */
export function enviarEnlaceAcceso(usuario, tipo, actor) {
  const token = randomBytes(24).toString('base64url');
  q.run('UPDATE usuarios SET activacion_hash=?, activacion_vence=? WHERE id=?', sha(token), enMin(POLITICA.activacionHoras * 60), usuario.id);
  if (tipo === 'activacion') q.run('UPDATE usuarios SET clave_hash=NULL, totp_secreto=NULL, totp_activo=0, totp_ultimo_paso=NULL WHERE id=?', usuario.id);
  q.run('DELETE FROM sesiones WHERE usuario_id=?', usuario.id);
  const enlace = `${(process.env.TRAZA_URL || 'http://localhost:3000').replace(/\/$/, '')}/activar/${token}`;
  const r = send(tipo === 'activacion' ? 'U1' : 'U2', { destinatario: usuario.correo, usuario_id: usuario.id,
    vars: { nombre: usuario.nombre, horas: POLITICA.activacionHoras }, privado: enlace });
  log({ usuario: actor ? (typeof actor === 'string' ? actor : quien(actor)) : 'sistema', entidad: 'usuario', entidad_id: usuario.id,
    accion: tipo === 'activacion' ? 'enlace de activación enviado (restablece clave y doble factor)' : 'enlace para restablecer contraseña enviado' });
  return { enlace, estado: r.estado };
}

export function usuarioPorToken(token) {
  const u = q.get('SELECT * FROM usuarios WHERE activacion_hash=? AND activo=1', sha(String(token)));
  if (!u || !u.activacion_vence || u.activacion_vence < nowIso()) return null;
  return u;
}
export function fijarClave(usuario, clave, clave2) {
  if (clave !== clave2) throw new AccesoError('Las contraseñas no coinciden');
  const p = problemasClave(clave, usuario);
  if (p.length) throw new AccesoError(`La contraseña debe tener ${p.join(', ')}`);
  q.run('UPDATE usuarios SET clave_hash=?, activacion_hash=NULL, activacion_vence=NULL, intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?', hashClave(clave), usuario.id);
  log({ usuario: quien(usuario), entidad: 'usuario', entidad_id: usuario.id, accion: 'contraseña definida' });
}

/** Paso 1 del ingreso. Devuelve el usuario si la clave es correcta; lanza AccesoError con un mensaje neutro si no. */
export function verificarIngreso(correo, clave) {
  const u = usuarioPorCorreo(correo);
  const neutro = new AccesoError('Correo o contraseña incorrectos');
  if (!u || !u.activo) { if (clave) scryptSync(String(clave), 'x', 64); throw neutro; } // tiempo similar exista o no
  if (u.bloqueado_hasta && u.bloqueado_hasta > nowIso()) throw new AccesoError(`Cuenta bloqueada temporalmente por intentos fallidos. Intente después de ${POLITICA.bloqueoMin} minutos o pida al administrador que la desbloquee.`);
  if (!u.clave_hash) throw new AccesoError('Su cuenta aún no está activada. Use el enlace de activación que recibió por correo o pida uno nuevo al administrador.');
  if (!verificarClave(String(clave || ''), u.clave_hash)) {
    const n = u.intentos_fallidos + 1;
    const bloquea = n >= POLITICA.intentosMax;
    q.run('UPDATE usuarios SET intentos_fallidos=?, bloqueado_hasta=? WHERE id=?', bloquea ? 0 : n, bloquea ? enMin(POLITICA.bloqueoMin) : null, u.id);
    log({ usuario: quien(u), entidad: 'usuario', entidad_id: u.id, accion: bloquea ? `cuenta bloqueada ${POLITICA.bloqueoMin} min por ${POLITICA.intentosMax} intentos fallidos` : 'intento de ingreso fallido' });
    throw neutro;
  }
  q.run('UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?', u.id);
  return u;
}

/** Prepara el alta del doble factor (genera el secreto si no hay uno pendiente). */
export function prepararAlta2fa(u) {
  if (u.totp_activo) return u.totp_secreto;
  if (u.totp_secreto) return u.totp_secreto;
  const s = nuevoSecretoTotp();
  q.run('UPDATE usuarios SET totp_secreto=? WHERE id=?', s, u.id);
  return s;
}
export function confirmar2fa(u, codigo, { alta = false } = {}) {
  const fresco = q.get('SELECT * FROM usuarios WHERE id=?', u.id);
  if (!fresco.totp_secreto) throw new AccesoError('No hay doble factor configurado');
  const paso = verificarTotp(fresco.totp_secreto, codigo, fresco.totp_ultimo_paso);
  if (paso == null) {
    log({ usuario: quien(u), entidad: 'usuario', entidad_id: u.id, accion: 'código de doble factor incorrecto' });
    throw new AccesoError('Código incorrecto o vencido. Use el código de 6 dígitos que muestra ahora su aplicación.');
  }
  q.run('UPDATE usuarios SET totp_ultimo_paso=?, totp_activo=1, ultimo_acceso=? WHERE id=?', paso, nowIso(), u.id);
  log({ usuario: quien(u), entidad: 'usuario', entidad_id: u.id, accion: alta ? 'doble factor activado' : 'inicio de sesión con doble factor' });
}

export function desbloquear(u, actor) {
  q.run('UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?', u.id);
  log({ usuario: quien(actor), entidad: 'usuario', entidad_id: u.id, accion: 'cuenta desbloqueada' });
}

// ---------- sesiones persistentes (servidor) ----------
export function crearSesion(usuarioId, { mfa = false, ip = null, agente = null } = {}) {
  const token = randomBytes(32).toString('base64url');
  q.run('INSERT INTO sesiones(id, usuario_id, creado_at, expira_at, mfa_ok, ip, agente) VALUES (?,?,?,?,?,?,?)',
    sha(token), usuarioId, new Date().toISOString(), new Date(Date.now() + POLITICA.sesionHoras * 3600_000).toISOString(), mfa ? 1 : 0, ip, agente?.slice(0, 200) || null);
  return token;
}
export function leerSesion(token) {
  if (!token) return null;
  const s = q.get(`SELECT s.*, u.activo FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.id=?`, sha(token));
  if (!s || !s.activo || s.expira_at < new Date().toISOString()) { if (s) q.run('DELETE FROM sesiones WHERE id=?', s.id); return null; }
  return s;
}
export const marcarSesion2fa = (token) => q.run('UPDATE sesiones SET mfa_ok=1 WHERE id=?', sha(token));
export const cerrarSesion = (token) => token && q.run('DELETE FROM sesiones WHERE id=?', sha(token));
export const cerrarSesionesDe = (usuarioId) => q.run('DELETE FROM sesiones WHERE usuario_id=?', usuarioId);
export const limpiarSesiones = () => q.run('DELETE FROM sesiones WHERE expira_at < ?', new Date().toISOString());

/** ¿Se permite el ingreso de demostración (selector de usuarios sin contraseña)? Nunca en producción. */
export const loginDemoPermitido = () => process.env.TRAZA_ENTORNO !== 'produccion' && process.env.TRAZA_LOGIN_DEMO !== '0';
