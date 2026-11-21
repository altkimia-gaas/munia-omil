// Traza OMIL — servidor HTTP sin dependencias externas (Node >= 22.5).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, q } from './lib/db.js';
import { seedBase, seedDemo } from './lib/seed.js';
import { tick, ReglaError } from './lib/engine.js';
import { publicRoutes } from './lib/routes-public.js';
import { staffRoutes } from './lib/routes-staff.js';
import { publicLayout, html } from './lib/views.js';

const PORT = Number(process.env.PORT || 3000);
const DB = process.env.TRAZA_DB || fileURLToPath(new URL('./data/traza.db', import.meta.url));
const nuevo = !existsSync(DB);
openDb(DB);
seedBase();
if (nuevo && process.env.TRAZA_DEMO !== '0') { seedDemo(); console.log('Escenario de demostración cargado.'); }

// ---------- sesiones (en memoria; en producción: almacén persistente) ----------
const sessions = new Map();
function session(req, res) {
  const m = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '');
  let sid = m?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomBytes(18).toString('base64url');
    sessions.set(sid, { creado: Date.now() });
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
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

async function readBody(req) {
  if (req.method !== 'POST') return new URLSearchParams();
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 1e6) throw new Error('Solicitud demasiado grande'); }
  return new URLSearchParams(data);
}

const STATIC = { '/static/style.css': ['public/style.css', 'text/css; charset=utf-8'] };

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
    user: sess.userId ? q.get('SELECT * FROM usuarios WHERE id=? AND activo=1', sess.userId) : null,
    flash: sess.flash,
    send(status, body, type = 'text/html; charset=utf-8', headers = {}) { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(body); },
    redirect(to, flash) { if (flash) sess.flash = flash; res.writeHead(303, { Location: to }); res.end(); },
    back(flash) { const ref = req.headers.referer; const to = ref && new URL(ref).host === req.headers.host ? new URL(ref).pathname + new URL(ref).search : '/'; this.redirect(to, flash); },
  };
  delete sess.flash;
  try {
    ctx.body = await readBody(req);
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
const runTick = () => { try { const r = tick(); if (Object.values(r).some(Boolean)) console.log('Temporizadores:', r); } catch (e) { console.error('tick', e); } };
runTick();
setInterval(runTick, 60_000).unref();

server.listen(PORT, () => console.log(`Traza OMIL en http://localhost:${PORT}  (portal público: /  ·  funcionarios: /login)`));
