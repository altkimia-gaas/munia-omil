// Demo navegable de Traza OMIL (GitHub Pages): el mismo núcleo y las mismas pantallas del servidor,
// ejecutados en el navegador con SQLite en WebAssembly. Los datos viven solo en este navegador.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { useSqlJs, openDb, exportDb, q } from './db-browser.js';
import { seedBase, seedDemo } from '../lib/seed.js';
import { tick, ReglaError } from '../lib/engine.js';
import { publicRoutes } from '../lib/routes-public.js';
import { staffRoutes } from '../lib/routes-staff.js';
import { publicLayout, html } from '../lib/views.js';

const KEY = 'traza-omil-demo-v2';
const SKEY = 'traza-omil-sesion';
const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch { /* almacenamiento bloqueado: la demo sigue en memoria */ } },
  del(k, s = localStorage) { try { s.removeItem(k); } catch { /* idem */ } },
};
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const persist = () => store.set(KEY, toB64(exportDb()));

// ---------- sesión ----------
let sess = {};
try { sess = JSON.parse(store.get(SKEY, sessionStorage) || '{}'); } catch { sess = {}; }
const saveSess = () => { const { flash, ...rest } = sess; store.set(SKEY, JSON.stringify(rest), sessionStorage); };

// ---------- rutas (idénticas al servidor) ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, handler });
};
publicRoutes(route);
staffRoutes(route);

let current = '/';

function download(body, type, headers) {
  const m = /filename="([^"]+)"/.exec(headers['Content-Disposition'] || '');
  const name = m ? m[1] : (type.includes('json') ? 'datos.json' : 'archivo.csv');
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function paint(pageHtml, frag) {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  document.title = doc.title;
  document.body.className = doc.body.className;
  document.body.innerHTML = doc.body.innerHTML;
  document.body.prepend(banner());
  if (frag) document.getElementById(frag)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

function banner() {
  const d = document.createElement('div');
  d.className = 'demo-band';
  d.setAttribute('role', 'note');
  d.innerHTML = '<span><strong>DEMOSTRACIÓN</strong> · Prototipo Traza OMIL. No es el portal oficial de la OMIL: datos ficticios, los avisos no se envían y todo queda solo en este navegador. No ingrese datos personales reales.</span><button type="button" data-reset>Reiniciar demo</button>';
  return d;
}

async function handle(method, target, body = new URLSearchParams()) {
  const url = new URL(target, 'https://demo.local');
  const [path, frag] = [url.pathname, url.hash.slice(1)];
  if (method === 'GET') current = path + url.search;
  let done = false;
  const ctx = {
    url, sess, params: {}, body,
    user: sess.userId ? q.get('SELECT * FROM usuarios WHERE id=? AND activo=1', sess.userId) : null,
    flash: sess.flash,
    send(status, out, type = 'text/html; charset=utf-8', headers = {}) {
      done = true;
      if (type.startsWith('text/html')) paint(out, frag);
      else download(out, type, headers);
    },
    redirect(to, flash) { done = true; if (flash) sess.flash = flash; go(to); },
    back(flash) { this.redirect(current, flash); },
  };
  if (method === 'GET') delete sess.flash;
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(path);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      await r.handler(ctx);
      break;
    }
    if (!done) ctx.send(404, publicLayout({ title: 'No encontrado', body: html`<h1>Página no encontrada</h1><p><a href="/">Volver al inicio</a></p>` }));
  } catch (e) {
    if (e instanceof ReglaError) return ctx.back({ tipo: 'error', regla: e.regla, msg: e.message });
    console.error(e);
    ctx.send(500, publicLayout({ title: 'Error', body: html`<h1>Ocurrió un error</h1><p>${e.message}</p><p><a href="/">Volver</a></p>` }));
  } finally {
    if (method === 'POST') persist();
    saveSess();
  }
}

function go(to) {
  const u = new URL(to, 'https://demo.local');
  const isDownload = /\.(csv|json)$/.test(u.pathname);
  if (!isDownload) history.pushState(null, '', '#' + u.pathname + u.search + (u.hash ? u.hash.replace('#', '~') : ''));
  handle('GET', to);
}

const fromHash = () => {
  const h = location.hash.slice(1) || '/';
  return h.startsWith('/') ? h.replace('~', '#') : null;
};

// ---------- interceptores ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-menu]')) { document.body.classList.toggle('menu-open'); return; }
  if (e.target.closest('[data-reset]')) {
    if (confirm('¿Reiniciar la demo? Se borran los cambios hechos en este navegador.')) { store.del(KEY); store.del(SKEY, sessionStorage); location.hash = ''; location.reload(); }
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#')) { e.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (!href.startsWith('/')) return; // enlaces externos
  e.preventDefault();
  if (a.closest('.side')) document.body.classList.remove('menu-open');
  go(href);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  const fd = new FormData(form, e.submitter || undefined);
  const params = new URLSearchParams();
  for (const [k, v] of fd) params.append(k, typeof v === 'string' ? v : v.name);
  const action = form.getAttribute('action') || current.split('?')[0];
  if ((form.getAttribute('method') || 'get').toLowerCase() === 'post') handle('POST', action, params);
  else go(`${action.split('?')[0]}?${params}`);
});

window.addEventListener('popstate', () => { const p = fromHash(); if (p) handle('GET', p); });

// ---------- arranque ----------
async function start() {
  globalThis.process ??= { env: {}, argv: [] };
  process.env.TRAZA_URL = location.origin + location.pathname + '#';
  const SQL = await initSqlJs({ wasmBinary: fromB64(window.__SQL_WASM__) });
  useSqlJs(SQL);
  const saved = store.get(KEY);
  let restored = false;
  if (saved) { try { openDb(fromB64(saved)); restored = !!q.get('SELECT 1 FROM usuarios LIMIT 1'); } catch { restored = false; } }
  if (!restored) { openDb(); seedBase(); seedDemo(); }
  tick(); persist();
  setInterval(() => { try { const r = tick(); if (Object.values(r).some(Boolean)) persist(); } catch (err) { console.error(err); } }, 60_000);
  handle('GET', fromHash() || '/');
}
start().catch((e) => {
  document.body.innerHTML = `<div style="padding:2rem;font-family:sans-serif;color:#F0F4FF">No se pudo iniciar la demo: ${String(e.message || e).replace(/</g, '&lt;')}</div>`;
  console.error(e);
});
