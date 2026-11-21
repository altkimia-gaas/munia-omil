// Pruebas del correo real (M7) contra un servidor SMTP falso local: cola, redirección de pruebas,
// rebotes, reintentos, autenticación, MIME y migración de bases antiguas.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, q, SCHEMA } from '../lib/db.js';
import { seedBase } from '../lib/seed.js';
import { send, reencolar } from '../lib/notify.js';
import { procesarCola, armarMensaje } from '../lib/mailer.js';
import { correoConfig } from '../lib/correo-config.js';

// ---------- servidor SMTP falso ----------
const recibidos = [];
let servidor, puerto;
let falla = {}; // { rcpt: { 'x@y': 550 }, data: 451, auth: true }
let auths = [];

function smtpFalso() {
  return net.createServer((s) => {
    s.setEncoding('utf8');
    let buf = '', enData = false, msg = null;
    const w = (l) => s.write(`${l}\r\n`);
    w('220 falso.local ESMTP');
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const linea = buf.slice(0, i); buf = buf.slice(i + 2);
        if (enData) {
          if (linea === '.') {
            enData = false;
            if (falla.data) { w(`${falla.data} Intente más tarde`); continue; }
            recibidos.push(msg); w('250 2.0.0 OK en cola');
          } else msg.datos.push(linea);
          continue;
        }
        const [cmd] = linea.split(/[ :]/);
        switch (cmd.toUpperCase()) {
          case 'EHLO': w('250-falso.local'); w('250-AUTH PLAIN LOGIN'); w('250 8BITMIME'); break;
          case 'AUTH': auths.push(linea); w('235 2.7.0 Autenticado'); break;
          case 'MAIL': msg = { de: linea, para: null, datos: [] }; w('250 OK'); break;
          case 'RCPT': {
            const dir = /<([^>]+)>/.exec(linea)[1];
            const cod = falla.rcpt?.[dir];
            if (cod) w(`${cod} 5.1.1 Buzón inexistente`); else { msg.para = dir; w('250 OK'); }
            break;
          }
          case 'DATA': enData = true; w('354 Fin con .'); break;
          case 'RSET': w('250 OK'); break;
          case 'QUIT': w('221 Adiós'); s.end(); break;
          default: w('502 No implementado');
        }
      }
    });
  });
}

const ENV0 = { ...process.env };
const configurar = (extra) => {
  for (const k of Object.keys(process.env)) if (/^(CORREO_|SMTP_|TRAZA_ENTORNO|RESEND_)/.test(k)) delete process.env[k];
  Object.assign(process.env, { CORREO_MODO: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PUERTO: String(puerto), SMTP_SEGURIDAD: 'ninguna',
    CORREO_REMITENTE: 'OMIL Casablanca <omil@municipalidad.test>', CORREO_RESPONDER_A: 'consultas@municipalidad.test' }, extra);
};
const estado = (id) => q.get('SELECT * FROM avisos WHERE id=?', id);
const decodificar = (m) => {
  const txt = m.datos.join('\n');
  const partes = txt.split(/\n--traza-[0-9a-f]+/);
  const plano = partes.find((p) => p.includes('text/plain'));
  return { cabeceras: txt.split('\n\n')[0], texto: Buffer.from(plano.split('\n\n')[1].replace(/\n/g, ''), 'base64').toString('utf8') };
};

before(async () => {
  servidor = smtpFalso();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  puerto = servidor.address().port;
  openDb(':memory:');
  seedBase();
});
after(() => { servidor.close(); process.env = ENV0; });
beforeEach(() => { recibidos.length = 0; falla = {}; auths = []; });

test('Modo simulado (predeterminado): no hay cola ni conexión', async () => {
  for (const k of ['CORREO_MODO']) delete process.env[k];
  const r = send('T0', { destinatario: 'alguien@correo.test', vars: {} });
  assert.equal(r.estado, 'entregado');
  assert.deepEqual(await procesarCola(), { enviados: 0, rebotados: 0, errores: 0, retenidos: 0, reintentos: 0 });
});

test('Salvaguarda: en pruebas y sin redirección, los avisos quedan retenidos', async () => {
  configurar({});
  const r = send('T0', { destinatario: 'postulante@correo.test', vars: {} });
  assert.equal(r.estado, 'pendiente');
  await procesarCola();
  assert.equal(estado(r.id).estado_entrega, 'retenido');
  assert.equal(recibidos.length, 0, 'no sale ningún correo');
});

test('En pruebas con redirección: llega al buzón de prueba, marcado como [PRUEBA]', async () => {
  configurar({ CORREO_REDIRIGIR_A: 'buzon-prueba@municipalidad.test', SMTP_USUARIO: 'omil', SMTP_CLAVE: 'secreta' });
  const r = send('A2', { destinatario: 'persona@correo.test', vars: { nombre: 'Josefa Ñúñez', cargo: 'Cajero/a', empleador: 'El Puerto', fecha_derivacion: '30-11-2026' } });
  const out = await procesarCola();
  assert.equal(out.enviados, 1);
  assert.equal(recibidos[0].para, 'buzon-prueba@municipalidad.test');
  const a = estado(r.id);
  assert.equal(a.estado_entrega, 'entregado');
  assert.equal(a.redirigido_a, 'buzon-prueba@municipalidad.test');
  assert.ok(a.id_proveedor?.startsWith('<aviso-'));
  assert.match(auths[0], /^AUTH PLAIN /, 'autentica con la cuenta institucional');
  const { cabeceras, texto } = decodificar(recibidos[0]);
  assert.match(cabeceras, /Subject: =\?UTF-8\?B\?/);
  assert.ok(Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(cabeceras)[1], 'base64').toString().startsWith('[PRUEBA → persona@correo.test]'));
  assert.match(cabeceras, /Reply-To: <consultas@municipalidad.test>/);
  assert.match(texto, /Josefa Ñúñez/, 'acentos y ñ intactos (UTF-8)');
});

test('Producción: va al destinatario real; 5xx en RCPT = rebotado', async () => {
  configurar({ TRAZA_ENTORNO: 'produccion' });
  falla = { rcpt: { 'noexiste@correo.test': 550 } };
  const ok = send('T0', { destinatario: 'existe@correo.test', vars: {} });
  const malo = send('T0', { destinatario: 'noexiste@correo.test', vars: {} });
  const out = await procesarCola();
  assert.equal(out.enviados, 1);
  assert.equal(out.rebotados, 1);
  assert.equal(recibidos[0].para, 'existe@correo.test');
  assert.equal(estado(ok.id).estado_entrega, 'entregado');
  assert.equal(estado(malo.id).estado_entrega, 'rebotado');
  assert.match(estado(malo.id).ultimo_error, /550|Buzón/);
});

test('Falla temporal (4xx): reintento programado; luego se envía', async () => {
  configurar({ TRAZA_ENTORNO: 'produccion' });
  falla = { data: 451 };
  const r = send('T0', { destinatario: 'tarde@correo.test', vars: {} });
  const out = await procesarCola();
  assert.equal(out.reintentos, 1);
  const a = estado(r.id);
  assert.equal(a.estado_entrega, 'pendiente');
  assert.equal(a.intentos, 1);
  assert.ok(a.proximo_intento > new Date().toISOString(), 'espera antes de reintentar');
  falla = {};
  q.run('UPDATE avisos SET proximo_intento=? WHERE id=?', new Date(0).toISOString(), r.id);
  await procesarCola();
  assert.equal(estado(r.id).estado_entrega, 'entregado');
  assert.equal(estado(r.id).intentos, 2);
});

test('Servidor caído: tras agotar intentos queda en error y se puede reencolar', async () => {
  configurar({ TRAZA_ENTORNO: 'produccion', SMTP_PUERTO: '1', CORREO_MAX_INTENTOS: '2' });
  const r = send('T0', { destinatario: 'x@correo.test', vars: {} });
  await procesarCola();
  q.run('UPDATE avisos SET proximo_intento=? WHERE id=?', new Date(0).toISOString(), r.id);
  await procesarCola();
  assert.equal(estado(r.id).estado_entrega, 'error');
  assert.equal(reencolar([r.id], 'prueba'), 1);
  assert.equal(estado(r.id).estado_entrega, 'pendiente');
  configurar({ TRAZA_ENTORNO: 'produccion' });
  await procesarCola();
  assert.equal(estado(r.id).estado_entrega, 'entregado');
});

test('MIME: puntos al inicio de línea y líneas base64 de 76 caracteres', () => {
  const cfg = correoConfig();
  const m = armarMensaje({ id: 9, tipo: 'T0', destinatario: 'a@b.test', asunto: 'Prueba', cuerpo: '.línea con punto\n'.repeat(20) }, 'a@b.test', cfg);
  assert.ok(m.datos.split('\r\n').every((l) => l.length <= 998));
  assert.ok(m.datos.includes('Content-Type: text/html; charset=UTF-8'));
});

test('Migración: una base de la versión anterior conserva sus avisos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'traza-'));
  const f = join(dir, 'vieja.db');
  const d = new DatabaseSync(f);
  // Esquema completo de la versión anterior: igual al actual salvo la tabla de avisos (sin cola).
  const ini = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS avisos');
  const fin = SCHEMA.indexOf(');', ini) + 2;
  const viejo = SCHEMA.slice(0, ini) + `CREATE TABLE IF NOT EXISTS avisos (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, postulacion_id INTEGER REFERENCES postulaciones(id),
    empleador_id INTEGER REFERENCES empleadores(id), oferta_id INTEGER REFERENCES ofertas(id), usuario_id INTEGER REFERENCES usuarios(id),
    destinatario TEXT NOT NULL, plantilla_version INTEGER, asunto TEXT NOT NULL, cuerpo TEXT NOT NULL, enviado_at TEXT NOT NULL,
    estado_entrega TEXT NOT NULL CHECK (estado_entrega IN ('entregado','rebotado','interno')));` + SCHEMA.slice(fin).replace(/CREATE INDEX IF NOT EXISTS ix_avisos_cola[^;]*;/, '');
  d.exec(viejo);
  d.exec(`INSERT INTO avisos VALUES (1,'A1',NULL,NULL,NULL,NULL,'p@x.test',1,'Asunto','Cuerpo','2026-11-01T10:00:00.000Z','entregado');`);
  d.close();
  const nueva = openDb(f);
  const a = nueva.prepare('SELECT * FROM avisos WHERE id=1').get();
  assert.equal(a.estado_entrega, 'entregado');
  assert.equal(a.entregado_at, '2026-11-01T10:00:00.000Z');
  nueva.prepare(`INSERT INTO avisos(tipo, destinatario, asunto, cuerpo, enviado_at, estado_entrega) VALUES ('T0','a@b.test','x','y','z','pendiente')`).run();
  nueva.close();
  rmSync(dir, { recursive: true, force: true });
});
