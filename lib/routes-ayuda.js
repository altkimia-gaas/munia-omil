// Centro de ayuda: guía para funcionarios (/app/ayuda) y para postulantes y empleadores (/ayuda).
import { html, raw, esc, icon, ROLES, publicLayout } from './views.js';
import { render } from './routes-staff.js';
import { PRIMEROS_PASOS, GUIAS, PREGUNTAS, GLOSARIO, AYUDA_PUBLICA, PREGUNTAS_PUBLICAS } from './ayuda.js';

// **negrita** y *cursiva* sobre texto ya escapado
const md = (s) => raw(esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>'));

const buscador = (placeholder) => html`<div class="search-box ayuda-buscar">${icon('buscar')}<input type="search" data-filtro=".ayuda-item" placeholder="${placeholder}" aria-label="${placeholder}"></div>
<p class="muted ayuda-sin-resultados" hidden>No hay resultados para esa búsqueda.</p>`;
const guia = (g, destacada = false) => html`<section class="card ayuda-item ${destacada ? 'ayuda-tu-rol' : ''}" id="${g.id}">
  <div class="row-between"><h2>${g.titulo}</h2>${g.roles ? html`<span class="chip c-mute">${g.roles}</span>` : ''}</div>
  <ol class="ayuda-pasos">${g.pasos.map((p) => html`<li>${md(p)}</li>`)}</ol></section>`;
const preguntas = (lista) => html`${lista.map(([pq, r]) => html`<details class="faq ayuda-item"><summary>${pq}</summary><p>${md(r)}</p></details>`)}`;

export function ayudaRoutes(route) {
  route('GET', '/app/ayuda', (c) => {
    if (!c.user) return c.redirect('/ayuda#funcionarios');
    const pasos = PRIMEROS_PASOS[c.user.rol] || [];
    render(c, 'Ayuda', html`<div class="ayuda">
<aside class="ayuda-indice" aria-label="Contenido de la ayuda"><div class="side-group">Contenido</div>
  <a href="#primeros-pasos">Primeros pasos</a>${GUIAS.map((g) => html`<a href="#${g.id}">${g.titulo}</a>`)}<a href="#preguntas">Preguntas frecuentes</a><a href="#glosario">Glosario</a>
</aside>
<div class="ayuda-cuerpo">
  <h1>Cómo usar Traza OMIL</h1>
  <p class="muted">Cada oferta y cada postulación es un expediente con estado, plazo y aviso automático. Tu trabajo es revisar, clasificar y validar; los avisos y los plazos los lleva el sistema.</p>
  ${buscador('Buscar en la ayuda: clasificar, rebote, acta, feriado…')}
  <section class="hero-action ayuda-item" id="primeros-pasos">
    <div class="ha-tag">Para tu rol · ${ROLES[c.user.rol]}</div>
    <h2 class="ha-title" style="font-size:20px">Primeros pasos</h2>
    <ol class="ayuda-pasos">${pasos.map((p) => html`<li>${md(p)}</li>`)}</ol>
  </section>
  <section class="card ayuda-flujo"><h2>El recorrido de una oferta</h2>
    <ol class="flujo">${[['En validación', 'La OMIL revisa requisitos'], ['Publicada', '10 días hábiles · Aviso 1 a cada postulante'], ['Derivada', 'Nómina al empleador · Aviso 2'], ['Recordatorios', 'Días 10 y 20'], ['Cerrada', 'Resultado → Aviso 3 · Día 30 sin respuesta → Aviso 4']]
      .map(([t, d], i) => html`<li><span class="flujo-n">${i + 1}</span><strong>${t}</strong><small>${d}</small></li>`)}</ol></section>
  ${GUIAS.map((g) => guia(g))}
  <h2 id="preguntas">Preguntas frecuentes</h2>
  ${preguntas(PREGUNTAS)}
  <h2 id="glosario">Glosario</h2>
  <div class="card"><dl class="dl">${GLOSARIO.map(([t, d]) => html`<dt class="ayuda-item">${t}</dt><dd>${d}</dd>`)}</dl></div>
  <p class="note">¿Algo no está aquí? Escribe a la jefatura OMIL o a Informática. La ayuda para postulantes y empleadores está en <a href="/ayuda">/ayuda</a>.</p>
</div></div>`);
  });

  route('GET', '/ayuda', (c) => c.send(200, publicLayout({ title: 'Ayuda', wide: true, flash: c.flash, body: html`<div class="ayuda">
<aside class="ayuda-indice" aria-label="Contenido de la ayuda"><div class="side-group">Contenido</div>
  ${AYUDA_PUBLICA.map((g) => html`<a href="#${g.id}">${g.titulo}</a>`)}<a href="#preguntas">Preguntas frecuentes</a><a href="#funcionarios">Funcionarios municipales</a>
</aside>
<div class="ayuda-cuerpo">
  <h1>Ayuda</h1>
  <p class="muted">La OMIL de Casablanca te avisa cuando recibe tu postulación, cuando la envía al empleador y cuando el proceso termina.</p>
  ${buscador('Buscar: código, correo, requisitos…')}
  ${AYUDA_PUBLICA.map((g) => guia(g))}
  <h2 id="preguntas">Preguntas frecuentes</h2>
  ${preguntas(PREGUNTAS_PUBLICAS)}
  ${guia({ ...GUIAS.find((g) => g.id === 'acceso'), id: 'funcionarios', titulo: 'Funcionarios municipales: cómo entrar', roles: '' })}
  <p class="note">¿Necesitas ayuda en persona? Chacabuco N°440, Casablanca · 32 2277406 · omilpersonas@municipalidadcasablanca.cl</p>
</div></div>` })));
}

