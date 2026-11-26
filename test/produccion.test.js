// Pruebas de lo necesario para producción: acceso con doble factor, firma con código, respaldos cifrados,
// webhook de rebotes, conciliación BNE, orientación y ayuda.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, q, getDb } from '../lib/db.js';
import { seedBase, seedDemo } from '../lib/seed.js';
import { setOffsetDays } from '../lib/clock.js';
import * as A from '../lib/auth.js';
import * as E from '../lib/engine.js';
import { respaldar, verificarRespaldo, restaurar, listarRespaldos } from '../lib/respaldo.js';
import { verificarFirmaSvix } from '../lib/routes-servidor.js';
import { anclaAyuda, GUIAS, PRIMEROS_PASOS } from '../lib/ayuda.js';
import { ROLES } from '../lib/views.js';

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'traza-prod-'));
  process.env.TRAZA_RESPALDOS = join(dir, 'respaldos');
  process.env.TRAZA_RESPALDO_CLAVE = 'una frase larga de prueba para el cifrado';
  openDb(':memory:');
  setOffsetDays(0);
  seedBase();
  seedDemo();
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ---------- acceso ----------
test('Contraseña: scrypt, verificación y política', () => {
  const h = A.hashClave('Casablanca 2026 segura');
  assert.match(h, /^scrypt\$/);
  assert.ok(A.verificarClave('Casablanca 2026 segura', h));
  assert.ok(!A.verificarClave('otra cosa', h));
  assert.ok(A.problemasClave('corta1').length > 0);
  assert.ok(A.problemasClave('solamenteletrasmuylargas').some((p) => p.includes('número')));
  assert.equal(A.problemasClave('una frase con 2 números').length, 0);
});

test('TOTP: vector de prueba RFC 6238 y tolerancia de un paso', () => {
  const sec = A.base32(Buffer.from('12345678901234567890'));
  assert.equal(sec, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(A.codigoTotp(sec, 1), '287082'); // T=59 s → 94287082 (8 dígitos)
  const p = A.pasoActual();
  assert.equal(A.verificarTotp(sec, A.codigoTotp(sec, p)), p);
  assert.equal(A.verificarTotp(sec, A.codigoTotp(sec, p - 1)), p - 1);
  assert.equal(A.verificarTotp(sec, A.codigoTotp(sec, p - 3)), null, 'códigos viejos no sirven');
  assert.equal(A.verificarTotp(sec, A.codigoTotp(sec, p), p), null, 'un código ya usado no se repite');
});

test('Activación por enlace, contraseña, alta de doble factor e ingreso', () => {
  const u = q.get(`SELECT * FROM usuarios WHERE rol='ejecutivo' LIMIT 1`);
  const { enlace } = A.enviarEnlaceAcceso(u, 'activacion', 'prueba');
  const token = enlace.split('/activar/')[1];
  const aviso = q.get(`SELECT * FROM avisos WHERE tipo='U1' ORDER BY id DESC LIMIT 1`);
  assert.ok(!aviso.cuerpo.includes(token), 'el enlace no queda legible en la bandeja de avisos');
  assert.throws(() => A.verificarIngreso(u.correo, 'lo que sea'), /no está activada/);
  const conToken = A.usuarioPorToken(token);
  assert.equal(conToken.id, u.id);
  assert.throws(() => A.fijarClave(conToken, 'Clave segura 2026', 'otra'), /no coinciden/);
  A.fijarClave(conToken, 'Clave segura 2026', 'Clave segura 2026');
  assert.equal(A.usuarioPorToken(token), null, 'el enlace sirve una sola vez');
  const ok = A.verificarIngreso(u.correo.toUpperCase(), 'Clave segura 2026');
  const sec = A.prepararAlta2fa(ok);
  assert.throws(() => A.confirmar2fa(ok, '000000', { alta: true }), /incorrecto/);
  A.confirmar2fa(ok, A.codigoTotp(sec, A.pasoActual()), { alta: true });
  assert.equal(q.get('SELECT totp_activo FROM usuarios WHERE id=?', u.id).totp_activo, 1);
});

test('Bloqueo tras 5 intentos fallidos y desbloqueo', () => {
  const u = q.get(`SELECT * FROM usuarios WHERE rol='ejecutivo' AND clave_hash IS NOT NULL LIMIT 1`);
  for (let i = 0; i < 5; i++) assert.throws(() => A.verificarIngreso(u.correo, 'mala'), /incorrectos/);
  assert.throws(() => A.verificarIngreso(u.correo, 'Clave segura 2026'), /bloqueada/, 'ni con la clave correcta mientras dura el bloqueo');
  A.desbloquear(u, { nombre: 'Admin', rol: 'admin' });
  assert.equal(A.verificarIngreso(u.correo, 'Clave segura 2026').id, u.id);
});

test('Sesiones: persistentes, con doble factor, y se cortan al dar de baja', () => {
  const u = q.get(`SELECT * FROM usuarios WHERE rol='jefatura'`);
  const t = A.crearSesion(u.id, { mfa: false });
  assert.equal(A.leerSesion(t).mfa_ok, 0);
  A.marcarSesion2fa(t);
  assert.equal(A.leerSesion(t).mfa_ok, 1);
  A.cerrarSesionesDe(u.id);
  assert.equal(A.leerSesion(t), null);
  assert.equal(A.leerSesion('inventado'), null);
});

test('Ingreso de demostración: nunca en producción', () => {
  delete process.env.TRAZA_ENTORNO;
  assert.equal(A.loginDemoPermitido(), true);
  process.env.TRAZA_ENTORNO = 'produccion';
  assert.equal(A.loginDemoPermitido(), false);
  delete process.env.TRAZA_ENTORNO;
});

// ---------- firma con código ----------
test('Declaración de entrevistador firmada con código de un solo uso y sellada', () => {
  const ej = q.get(`SELECT * FROM usuarios WHERE rol='ejecutivo' LIMIT 1`);
  const muni = q.get(`SELECT id FROM empleadores WHERE tipo='municipal'`).id;
  const id = E.crearOferta({ empleador_id: muni, cargo: 'Administrativo/a', ejecutivo_id: ej.id, requisitos: [{ descripcion: 'Media completa', tipo: 'excluyente', categoria: 'formacion' }],
    entrevistadores: [{ nombre: 'Rosa', correo: 'rosa@municipalidad.test' }, { nombre: 'Sin Correo' }] });
  E.publicarOferta(id, {}, ej);
  const [rosa, sinCorreo] = q.all('SELECT * FROM entrevistadores WHERE oferta_id=? ORDER BY id', id);
  assert.throws(() => E.solicitarCodigoFirma(id, sinCorreo.id), /no tiene correo/);
  const { codigo } = E.solicitarCodigoFirma(id, rosa.id);
  assert.match(codigo, /^\d{6}$/);
  assert.ok(!q.get(`SELECT cuerpo FROM avisos WHERE tipo='F1' ORDER BY id DESC LIMIT 1`).cuerpo.includes(codigo), 'el código no queda legible');
  assert.throws(() => E.verificarCodigoFirma(id, rosa.id, '000000'), /incorrecto/);
  E.verificarCodigoFirma(id, rosa.id, codigo);
  assert.throws(() => E.verificarCodigoFirma(id, rosa.id, codigo), /venció o no existe/, 'un solo uso');
  E.declarar(id, { tipo: 'entrevistador', id: rosa.id, nombre: 'Rosa', declara_vinculo: false, firma: 'Rosa', verificacion: 'Código verificado' });
  const d = q.get(`SELECT * FROM declaraciones WHERE oferta_id=? AND declarante_id=?`, id, rosa.id);
  assert.equal(d.verificacion, 'Código verificado');
  assert.match(d.sello, /^[0-9a-f]{64}$/);
});

// ---------- respaldos ----------
test('Respaldo cifrado: se crea, se verifica y se restaura íntegro', () => {
  const r = respaldar(getDb(), { motivo: 'prueba' });
  assert.ok(r.cifrado);
  const bruto = readFileSync(join(process.env.TRAZA_RESPALDOS, r.archivo));
  assert.equal(bruto.subarray(0, 4).toString(), 'TRZ1');
  assert.ok(!bruto.includes(Buffer.from('SQLite format 3')), 'no se puede leer sin la clave');
  const v = verificarRespaldo(r.archivo);
  assert.ok(v.ok);
  assert.equal(v.ofertas, q.get('SELECT COUNT(*) n FROM ofertas').n);
  const destino = join(dir, 'restaurada.db');
  const res = restaurar(r.archivo, destino);
  assert.equal(res.postulaciones, q.get('SELECT COUNT(*) n FROM postulaciones').n);
  const clave = process.env.TRAZA_RESPALDO_CLAVE;
  process.env.TRAZA_RESPALDO_CLAVE = 'otra clave';
  assert.throws(() => verificarRespaldo(r.archivo), /Clave incorrecta/);
  process.env.TRAZA_RESPALDO_CLAVE = clave;
  assert.equal(listarRespaldos().length, 1);
});

// ---------- webhook ----------
test('Webhook de correo: acepta solo firmas Svix válidas y recientes', () => {
  const secreto = `whsec_${Buffer.from('secreto-de-prueba').toString('base64')}`;
  const raw = '{"type":"email.bounced","data":{"email_id":"x"}}';
  const ts = String(Math.floor(Date.now() / 1000));
  const firma = createHmac('sha256', Buffer.from('secreto-de-prueba')).update(`msg_1.${ts}.${raw}`).digest('base64');
  const h = { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${firma}` };
  assert.equal(verificarFirmaSvix(secreto, h, raw), null);
  assert.equal(verificarFirmaSvix(secreto, h, raw.replace('bounced', 'delivered')), 'firma inválida');
  assert.equal(verificarFirmaSvix(secreto, h, raw, Number(ts) + 3600), 'marca de tiempo fuera de rango');
  assert.equal(verificarFirmaSvix('', h, raw), 'no autorizado');
});

// ---------- M12 y M13 ----------
test('Conciliación BNE: coincidencias, faltantes en ambos lados y marca de ofertas', () => {
  const contratados = [];
  for (const o of q.all(`SELECT * FROM ofertas WHERE estado='cerrada_con_resultado'`)) {
    for (const pid of JSON.parse(E.resultadoVigente(o.id).contratados_json)) {
      contratados.push({ rut: q.get('SELECT pe.rut FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id WHERE p.id=?', pid).rut, oferta: o.codigo });
    }
  }
  assert.ok(contratados.length >= 2);
  const [primero, ...resto] = contratados;
  const csv = ['RUT;Código Oferta;Fecha colocación', ...resto.map((c) => `${c.rut};${c.oferta};2026-10-10`), '11.111.111-1;OF-2026-0099;2026-10-11'].join('\n');
  const id = E.conciliarBne(csv, 'bne.csv', null);
  const r = JSON.parse(q.get('SELECT resumen_json FROM conciliaciones_bne WHERE id=?', id).resumen_json);
  assert.equal(r.coinciden, resto.length);
  assert.deepEqual(r.solo_traza.map((x) => x.rut), [primero.rut]);
  assert.equal(r.solo_bne.length, 1);
  assert.equal(q.get('SELECT registrada_bne FROM ofertas WHERE codigo=?', primero.oferta).registrada_bne, 0);
});

test('Orientación: solo se invita a quien autorizó comunicaciones', () => {
  const eleg = E.elegiblesOrientacion();
  assert.ok(eleg.length > 0);
  for (const p of eleg) assert.ok(E.consentimientoVigente(p.id, 'comunicaciones'));
  const t = E.crearTaller({ nombre: 'Taller de currículum', fecha: '2027-01-15' });
  const sinPermiso = q.get(`SELECT pe.id FROM personas pe WHERE NOT EXISTS (SELECT 1 FROM consentimientos c WHERE c.persona_id=pe.id AND c.tipo='comunicaciones' AND c.estado='vigente') LIMIT 1`).id;
  const n = E.invitarTaller(t, [...eleg.map((p) => p.id), sinPermiso]);
  assert.equal(n, eleg.length);
  assert.equal(E.invitarTaller(t, eleg.map((p) => p.id)), 0, 'no repite invitaciones');
  E.revocarConsentimiento(eleg[0].id, 'comunicaciones');
  assert.ok(!E.elegiblesOrientacion().some((p) => p.id === eleg[0].id));
});

// ---------- ayuda ----------
test('Ayuda: cada rol tiene primeros pasos y cada pantalla su guía', () => {
  for (const r of Object.keys(ROLES)) assert.ok(PRIMEROS_PASOS[r]?.length, `primeros pasos para ${r}`);
  assert.equal(anclaAyuda('/app'), 'panel');
  assert.equal(anclaAyuda('/app/ofertas/3'), 'ofertas');
  assert.equal(anclaAyuda('/app/postulaciones/9'), 'clasificar');
  assert.equal(anclaAyuda('/app/bne'), 'bne');
  assert.equal(anclaAyuda('/app/algo-nuevo'), 'primeros-pasos');
  assert.equal(new Set(GUIAS.map((g) => g.id)).size, GUIAS.length, 'anclas únicas');
});
