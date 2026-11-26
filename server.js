// Traza OMIL — servidor HTTP sin dependencias externas (Node >= 22.5).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, q } from './lib/db.js';
import { seedBase, seedDemo } from './lib/seed.js';
import { tick, ReglaError } from './lib/engine.js';
import { leerSesion, crearSesion, cerrarSesion, marcarSesion2fa, limpiarSesiones } from './lib/auth.js';
import { procesarCola } from './lib/mailer.js';
import { resumenCorreo } from './lib/correo-config.js';
import { publicRoutes } from './lib/routes-public.js';
import { staffRoutes } from './lib/routes-staff.js';
import { servidorRoutes } from './lib/routes-servidor.js';
import { ayudaRoutes } from './lib/routes-ayuda.js';
import { respaldar, respaldoPendiente } from './lib/respaldo.js';
import { log } from './lib/audit.js';
import { getDb } from './lib/db.js';
import { publicLayout, html } from './lib/views.js';

const PORT = Number(process.env.PORT || 3000);
const DB = process.env.TRAZA_DB || fileURLToPath(new URL('./data/traza.db', import.meta.url));
const nuevo = !existsSync(DB);
openDb(DB);
seedBase();
const PRODUCCION = process.env.TRAZA_ENTORNO === 'produccion';
if (nuevo && process.env.TRAZA_DEMO !== '0' && !PRODUCCION) { seedDemo(); console.log('Escenario de demostración cargado.'); }

// ---------- sesiones ----------
// "sid": preferencias efímeras (mensajes, postulante). "tsid": sesión de funcionario, persistida en la base (lib/auth.js).
const SECURE = (process.env.TRAZA_URL || '').startsWith('https://') ? '; Secure' : '';
function addCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), c]);
}
const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([\\w-]+)`).exec(req.headers.cookie || '')?.[1];
const sessions = new Map();
function session(req, res) {
  const m = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '');
  let sid = m?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomBytes(18).toString('base64url');
    sessions.set(sid, { creado: Date.now() });
    addCookie(res, `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${SECURE}`);
  }
  return sessions.get(sid);
}

// ---------- enrutador ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, handler });
};
publicRoutes(route);
staffRoutes(route);
ayudaRoutes(route);
servidorRoutes(route);

async function readBody(req) {
  if (req.method !== 'POST') return '';
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 5e6) throw new Error('Solicitud demasiado grande'); }
  return data;
}

const STATIC = { '/static/style.css': ['public/style.css', 'text/css; charset=utf-8'], '/static/app.js': ['public/app.js', 'text/javascript; charset=utf-8'] };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (STATIC[url.pathname]) {
    const [f, type] = STATIC[url.pathname];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    return res.end(readFileSync(new URL(f, import.meta.url)));
  }
  const sess = session(req, res);
  const ctx = {
    req, res, url, sess, params: {},
    user: null, pendiente: null,
    flash: sess.flash,
    send(status, body, type = 'text/html; charset=utf-8', headers = {}) { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(body); },
    redirect(to, flash) { if (flash) sess.flash = flash; res.writeHead(303, { Location: to }); res.end(); },
    back(flash) { const ref = req.headers.referer; const to = ref && new URL(ref).host === req.headers.host ? new URL(ref).pathname + new URL(ref).search : '/'; this.redirect(to, flash); },
  };
  delete sess.flash;
  // Sesión de funcionario: completa solo con doble factor (o ingreso de demostración fuera de producción)
  let tsid = cookie(req, 'tsid');
  const sa = leerSesion(tsid);
  if (sa) {
    const u = q.get('SELECT * FROM usuarios WHERE id=? AND activo=1', sa.usuario_id);
    if (sa.mfa_ok) ctx.user = u; else ctx.pendiente = u;
  }
  ctx.auth = {
    iniciar(usuarioId, { mfa = false } = {}) {
      cerrarSesion(tsid);
      tsid = crearSesion(usuarioId, { mfa, ip: req.socket.remoteAddress, agente: req.headers['user-agent'] });
      addCookie(res, `tsid=${tsid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 3600}${SECURE}`);
    },
    completar() { marcarSesion2fa(tsid); },
    cerrar() { cerrarSesion(tsid); addCookie(res, `tsid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE}`); },
  };
  try {
    ctx.raw = await readBody(req);
    ctx.body = new URLSearchParams((req.headers['content-type'] || '').includes('json') ? '' : ctx.raw);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.rx.exec(url.pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      return await r.handler(ctx);
    }
    ctx.send(404, publicLayout({ title: 'No encontrado', body: html`<h1>Página no encontrada</h1><p><a href="/">Volver al inicio</a></p>` }));
  } catch (e) {
    if (e instanceof ReglaError) return ctx.back({ tipo: 'error', regla: e.regla, msg: e.message });
    console.error(e);
    ctx.send(500, publicLayout({ title: 'Error', body: html`<h1>Ocurrió un error</h1><p>${e.message}</p><p><a href="/">Volver</a></p>` }));
  }
});

// Motor de temporizadores: cada minuto (y al iniciar)
const runRespaldo = () => {
  try {
    if (!respaldoPendiente()) return;
    const r = respaldar(getDb());
    log({ entidad: 'sistema', accion: `respaldo diario ${r.archivo}`, despues: { cifrado: r.cifrado, bytes: r.bytes } });
    console.log(`Respaldo diario: ${r.archivo}${r.cifrado ? '' : ' (SIN CIFRAR: configure TRAZA_RESPALDO_CLAVE)'}`);
  } catch (e) { console.error('respaldo', e); }
};
const runTick = () => { runRespaldo(); try { limpiarSesiones(); const r = tick(); if (Object.values(r).some(Boolean)) console.log('Temporizadores:', r); } catch (e) { console.error('tick', e); } };
runTick();
setInterval(runTick, 60_000).unref();

// Cola de correo: cada 15 s y justo después de cada acción que pueda generar avisos
const runCola = () => procesarCola().then((r) => { if (Object.values(r).some(Boolean)) console.log('Correo:', r); }).catch((e) => console.error('correo', e));
setInterval(runCola, 15_000).unref();
server.on('request', (req, res) => { if (req.method === 'POST') res.on('finish', () => setImmediate(runCola)); });
const rc = resumenCorreo();
console.log(`Correo de avisos: ${rc.modo} · entorno ${rc.entorno} · ${rc.destino}${rc.redirigirA ? ` · redirigido a ${rc.redirigirA}` : ''}`);
rc.problemas.forEach((p) => console.warn(`  ⚠ ${p}`));

server.listen(PORT, () => console.log(`Traza OMIL en http://localhost:${PORT}  (portal público: /  ·  funcionarios: /login)`));
