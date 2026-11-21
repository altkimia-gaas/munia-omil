// Plantillas HTML (renderizado en servidor). `html` escapa toda interpolación salvo raw().
import { fmtDate, fmtDateTime, today, offsetDays } from './clock.js';
import { ESTADO_OFERTA, ESTADO_POST } from './engine.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v === null || v === undefined ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Raw(out);
}
export { fmtDate, fmtDateTime };

export const ROLES = {
  ejecutivo: 'Ejecutivo/a OMIL', jefatura: 'Jefatura OMIL', control: 'Dirección de Control',
  admin: 'Administrador (Informática)', dpo: 'Encargado/a de datos personales', dideco: 'Dirección de Desarrollo Comunal',
};

const TONO_OFERTA = { en_validacion: 'warn', observada: 'warn', publicada: 'info', derivada: 'accent', cerrada_con_resultado: 'ok', cerrada_sin_respuesta: 'danger', desierta_anulada: 'muted' };
const TONO_POST = { recibida: 'muted', clasificada: 'info', derivada: 'accent', seleccionada: 'ok', no_seleccionada: 'muted', cerrada_sin_resultado: 'danger', retirada: 'muted' };
const CHIP = { ok: 'c-ok', warn: 'c-warn', danger: 'c-bad', info: 'c-info', accent: 'c-purp', muted: 'c-mute' };
export const badge = (txt, tono = 'muted') => html`<span class="chip ${CHIP[tono] || 'c-mute'}">${txt}</span>`;
export const badgeOferta = (e) => badge(ESTADO_OFERTA[e] || e, TONO_OFERTA[e]);
export const badgePost = (e) => badge(ESTADO_POST[e] || e, TONO_POST[e]);
export const badgeClasif = (c) => (c === 'cumple' ? badge('Cumple', 'ok') : c === 'no_cumple' ? badge('No cumple', 'warn') : badge('Sin clasificar', 'muted'));

export function flash(f) {
  if (!f) return '';
  return html`<div class="flash flash-${f.tipo}" role="${f.tipo === 'error' ? 'alert' : 'status'}">${f.regla ? html`<strong>${f.regla}</strong> · ` : ''}${f.msg}</div>`;
}

// Iconos de trazo (mismo estilo que MunIA Fomento)
const ICON = {
  panel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  ofertas: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18"/>',
  empleadores: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>',
  avisos: '<path d="M4 4h16v12H5.2L4 17.2V4z"/><path d="M8 9h8M8 12h5"/>',
  reportes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  auditoria: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  plantillas: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  datos: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  salir: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  logo: '<path d="M4 6h8M4 10h6M4 14h7"/><circle cx="17" cy="15" r="5"/><path d="M20.5 18.5L23 21"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};
export const icon = (k, cls = '') => raw(`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`);
const brand = (tag) => html`<div class="side-brand"><div class="side-ico">${icon('logo')}</div><div><div class="side-name"><span>Mun</span>IA</div><div class="side-tag">${tag}</div></div></div>`;

const NAV = [
  ['Operación', [
    ['/app', 'Panel', 'panel', ['ejecutivo', 'jefatura', 'control', 'dideco', 'dpo', 'admin']],
    ['/app/ofertas', 'Ofertas', 'ofertas', ['ejecutivo', 'jefatura', 'control']],
    ['/app/empleadores', 'Empleadores', 'empleadores', ['ejecutivo', 'jefatura']],
    ['/app/avisos', 'Avisos', 'avisos', ['ejecutivo', 'jefatura']],
  ]],
  ['Control', [
    ['/app/reportes', 'Reportes', 'reportes', ['ejecutivo', 'jefatura', 'control', 'dideco']],
    ['/app/auditoria', 'Auditoría', 'auditoria', ['ejecutivo', 'jefatura', 'control', 'admin']],
  ]],
  ['Configuración', [
    ['/app/plantillas', 'Plantillas', 'plantillas', ['jefatura']],
    ['/app/datos', 'Datos personales', 'datos', ['dpo', 'jefatura']],
    ['/app/admin', 'Administración', 'admin', ['admin', 'jefatura']],
  ]],
];
const SECCION = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([href, label]) => [href, label])));
const activo = (href, path) => (href === '/app' ? path === '/app' : path.startsWith(href));
const iniciales = (n) => (n || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const MENU_JS = raw(`<script>document.addEventListener('click',function(e){var t=e.target.closest('[data-menu]');if(t){document.body.classList.toggle('menu-open');}});</script>`);

export function staffLayout({ title, user, path, body, flash: f }) {
  const off = offsetDays();
  const seccion = Object.entries(SECCION).filter(([h]) => activo(h, path)).map(([, l]) => l).pop() || title;
  return page({
    title, cls: 'staff',
    body: html`
<a class="skip" href="#main">Saltar al contenido</a>
<div class="app">
  <div class="scrim" data-menu></div>
  <aside class="side" aria-label="Menú">
    ${brand('Traza OMIL')}
    <nav class="side-nav" aria-label="Principal">${NAV.map(([grupo, items]) => {
    const vis = items.filter(([, , , r]) => r.includes(user.rol));
    return vis.length ? html`<div class="side-group">${grupo}</div>${vis.map(([href, label, ic]) =>
      html`<a class="side-link ${activo(href, path) ? 'on' : ''}" href="${href}" ${activo(href, path) ? raw('aria-current="page"') : ''}>${icon(ic)}${label}</a>`)}` : '';
  })}</nav>
    <div class="side-foot">
      <div class="role-switch">Fecha del sistema</div>
      <div class="side-date mono">${fmtDate(today())}${off ? html` <span class="chip c-warn">${off > 0 ? '+' : ''}${off} d</span>` : ''}</div>
      ${['jefatura', 'admin'].includes(user.rol) ? html`<form method="post" action="/app/reloj">
        <input type="hidden" name="volver" value="${path}">
        <div class="role-switch" style="margin-top:.8rem">Prueba de plazos (demo)</div>
        <div class="role-pills">
          <button name="dias" value="1" class="role-pill">+1 d</button><button name="dias" value="5" class="role-pill">+5 d</button><button name="dias" value="10" class="role-pill">+10 d</button>
          ${off ? html`<button name="dias" value="reset" class="role-pill">Hoy</button>` : ''}
        </div></form>` : ''}
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="menu-btn" type="button" data-menu aria-label="Abrir menú">${icon('menu')}</button>
      <div><div class="topbar-h">${seccion}</div><div class="crumb">MunIA · Traza OMIL / ${seccion}</div></div>
      <div class="topbar-r">
        <div class="user-chip"><div class="user-av">${iniciales(user.nombre)}</div><div class="user-meta"><div class="user-name">${user.nombre}</div><div class="user-role">${ROLES[user.rol]}</div></div></div>
        <a href="/logout" class="notif-btn" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('salir')}</a>
      </div>
    </header>
    <main id="main" class="view">${flash(f)}${body}</main>
  </div>
</div>${MENU_JS}`,
  });
}

export function publicLayout({ title, body, flash: f, wide = false }) {
  return page({
    title, cls: 'public',
    body: html`
<a class="skip" href="#main">Saltar al contenido</a>
<header class="topbar pubbar">
  <a class="pub-brand" href="/"><div class="side-ico">${icon('logo')}</div><div><div class="side-name"><span>Mun</span>IA OMIL</div><div class="side-tag">Intermediación laboral · Casablanca</div></div></a>
  <nav class="pub-nav" aria-label="Principal"><a href="/">Ofertas</a><a href="/mis-postulaciones">Mis postulaciones</a><a href="/empleadores/publicar">Soy empleador</a></nav>
</header>
<main id="main" class="view pub-view ${wide ? '' : 'narrow'}">${flash(f)}${body}</main>
<footer class="pubfoot">
  <p>Oficina Municipal de Información Laboral · Chacabuco N°440, Casablanca · omilpersonas@municipalidadcasablanca.cl · 32 2277406</p>
  <p><a href="/privacidad">Aviso de privacidad</a> · <a href="/api/ofertas.json">Datos abiertos (JSON)</a> · <a href="/login">Acceso funcionarios municipales →</a></p>
</footer>`,
  });
}

/** Pantalla de acceso (estilo "gate" de MunIA Fomento) */
export function gateLayout({ title, body }) {
  return page({
    title, cls: 'gate-page',
    body: html`<div class="gate"><div class="gate-grid"></div><div class="gate-glow"></div>
<main class="gate-inner" id="main">
  <div class="gate-brand"><div class="gate-ico">${icon('logo')}</div><div class="gate-name"><span>Mun</span>IA OMIL</div></div>
  <div class="gate-tag">Traza OMIL · Intermediación laboral</div>
  ${body}
</main></div>`,
  });
}

function page({ title, body, cls }) {
  return html`<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · MunIA OMIL</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css"></head>
<body class="${cls}">${body}</body></html>`.s;
}

export function table(cols, rows, empty = 'Sin registros') {
  if (!rows.length) return html`<p class="empty">${empty}</p>`;
  return html`<div class="tablewrap"><table class="tbl"><thead><tr>${cols.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
<tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`;
}

export const kpi = (label, value, tono = '', href = null) =>
  href ? html`<a class="kpi clickable ${tono}" href="${href}"><span class="l">${label}</span><span class="v">${value}</span></a>`
    : html`<div class="kpi ${tono}"><span class="l">${label}</span><span class="v">${value}</span></div>`;

export const field = (label, input, hint = '') => html`<label class="field"><span>${label}</span>${input}${hint ? html`<small>${hint}</small>` : ''}</label>`;
export const sel = (name, opts, selected = '', attrs = '') => html`<select name="${name}" ${raw(attrs)}>${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === String(selected) ? raw('selected') : ''}>${l}</option>`)}</select>`;
