// Canales externos: portal del postulante (M1), canal del empleador (M2) y publicación (M11).
import { q } from './db.js';
import * as E from './engine.js';
import { today, fmtDate, fmtDateTime, toDate, addDays, calendarDaysBetween } from './clock.js';
import { publicLayout, html, raw, table, field, sel, badge, badgeClasif, icon } from './views.js';

const TXT_POSTULAR = `Autorizo a la I. Municipalidad de Casablanca, a través de la OMIL, a tratar mis datos personales con la finalidad de gestionar esta postulación: registrarla, clasificarla según los requisitos de la oferta, enviarla al empleador e informarme del resultado. Puedo ejercer mis derechos de acceso, rectificación, supresión y oposición (Ley N°19.628, modificada por la Ley N°21.719).`;
const TXT_BANCO = `Además, autorizo que la OMIL mantenga mis antecedentes en su banco de postulantes para informarme de futuras ofertas. Es voluntario, no afecta esta postulación y puedo revocarlo en cualquier momento.`;

const ofertaPublica = (o) => ({
  codigo: o.codigo, cargo: o.cargo, empleador: o.razon_social, area: o.area, vacantes: o.vacantes, comuna: o.comuna,
  estado: E.ESTADO_OFERTA[o.estado], postulacion_hasta: o.fecha_cierre_postulacion, publicada: o.publicada_at && toDate(o.publicada_at),
  cerrada: o.cerrada_at && toDate(o.cerrada_at),
});

export function publicRoutes(route) {
  // ---------- M11: página pública de ofertas vigentes y cerradas (RN-17: sin datos personales) ----------
  route('GET', '/', (c) => {
    const vigentes = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado='publicada' ORDER BY o.fecha_cierre_postulacion`);
    const enProceso = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado='derivada' ORDER BY o.derivada_at DESC`);
    const cerradas = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada') ORDER BY o.cerrada_at DESC LIMIT 30`);
    c.send(200, publicLayout({
      title: 'Ofertas laborales', wide: true, flash: c.flash,
      body: html`
<section class="hero-action">
  <div class="ha-tag">Ofertas laborales OMIL</div>
  <h1 class="ha-title">Si postulas a través de la OMIL, sabrás en qué quedó tu postulación</h1>
  <p class="ha-desc">Te avisamos cuando la <strong>recibimos</strong>, cuando la <strong>enviamos al empleador</strong> y cuando el <strong>proceso termina</strong>, aunque el empleador no responda.</p>
  <div class="ha-meta"><span class="ha-meta-item">${icon('ofertas')}<strong>${vigentes.length}</strong> ofertas vigentes</span><span class="ha-meta-item">${icon('reloj')}Cierre garantizado a <strong>30 días</strong></span></div>
  <a class="ha-cta" href="/mis-postulaciones">${icon('buscar')}Consultar mis postulaciones</a>
</section>
<h2>Vigentes <span class="count">${vigentes.length}</span></h2>
${vigentes.length ? html`<ul class="cards">${vigentes.map((o) => html`<li class="card">
  <h3><a href="/ofertas/${o.codigo}">${o.cargo}</a></h3>
  <p class="muted">${o.razon_social} · ${o.comuna} · ${o.vacantes} ${o.vacantes > 1 ? 'vacantes' : 'vacante'}</p>
  <p>Postula hasta el <strong>${fmtDate(o.fecha_cierre_postulacion)}</strong></p>
  <a class="btn btn-sm" href="/ofertas/${o.codigo}">Ver y postular<span class="sr"> a ${o.cargo}</span></a></li>`)}</ul>` : html`<p class="empty">No hay ofertas vigentes en este momento.</p>`}
<h2>En proceso de selección</h2>
${table(['Cargo', 'Empleador', 'Antecedentes enviados', 'Estado'], enProceso.map((o) => [o.cargo, o.razon_social, fmtDate(toDate(o.derivada_at)), 'El empleador está seleccionando']), 'Ninguna')}
<h2>Cerradas</h2>
${table(['Cargo', 'Empleador', 'Cierre', 'Resultado'], cerradas.map((o) => [o.cargo, o.razon_social, fmtDate(toDate(o.cerrada_at)), E.ESTADO_OFERTA[o.estado]]), 'Ninguna')}`,
    }));
  });

  route('GET', '/api/ofertas.json', (c) => {
    const rows = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado NOT IN ('en_validacion','observada') ORDER BY o.id`);
    c.send(200, JSON.stringify({ generado: new Date().toISOString(), licencia: 'Datos abiertos municipales', ofertas: rows.map(ofertaPublica) }, null, 2), 'application/json; charset=utf-8', { 'Access-Control-Allow-Origin': '*' });
  });

  route('GET', '/ofertas/:codigo', (c) => {
    const o = q.get(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.codigo=? AND o.estado NOT IN ('en_validacion','observada')`, c.params.codigo);
    if (!o) return c.send(404, publicLayout({ title: 'No encontrada', body: html`<h1>Oferta no encontrada</h1>` }));
    const reqs = q.all('SELECT * FROM requisitos WHERE oferta_id=? ORDER BY tipo, id', o.id);
    const abierta = o.estado === 'publicada' && today() <= o.fecha_cierre_postulacion;
    c.send(200, publicLayout({
      title: o.cargo, flash: c.flash,
      body: html`
<p><a href="/">← Todas las ofertas</a></p>
<h1>${o.cargo}</h1>
<p class="muted">${o.razon_social} · ${o.area || ''} · Código ${o.codigo}</p>
<dl class="dl">
  <dt>Vacantes</dt><dd>${o.vacantes}</dd>
  <dt>Jornada</dt><dd>${o.jornada || '—'}</dd>
  <dt>Renta</dt><dd>${o.renta || '—'}</dd>
  <dt>Lugar</dt><dd>${o.comuna}</dd>
  <dt>Postulación hasta</dt><dd><strong>${fmtDate(o.fecha_cierre_postulacion)}</strong></dd>
  <dt>Envío al empleador</dt><dd>${fmtDate(o.fecha_derivacion)}</dd>
</dl>
${o.funciones ? html`<h2>Funciones</h2><p>${o.funciones}</p>` : ''}
${o.condiciones ? html`<p>${o.condiciones}</p>` : ''}
<h2>Requisitos</h2>
<ul class="reqs">${reqs.map((r) => html`<li class="${r.tipo}">${r.tipo === 'excluyente' ? html`<strong>Excluyente:</strong> ` : html`<span class="muted">Deseable:</span> `}${r.descripcion}</li>`)}</ul>
<p class="note">Solo los requisitos <strong>excluyentes</strong> determinan si su postulación "cumple". Igual enviamos todas las postulaciones al empleador.</p>
${abierta ? formPostular(o, c.flash?.datos) : html`<div class="flash flash-info">Esta oferta ya no recibe postulaciones. Estado: ${E.ESTADO_OFERTA[o.estado]}.</div>`}`,
    }));
  });

  route('POST', '/ofertas/:codigo/postular', (c) => {
    const o = q.get('SELECT * FROM ofertas WHERE codigo=?', c.params.codigo);
    if (!o) return c.redirect('/');
    const b = c.body;
    const datos = Object.fromEntries(['rut', 'nombre', 'correo', 'telefono', 'comuna'].map((k) => [k, b.get(k) || '']));
    try {
      const r = E.postular({ oferta_id: o.id, ...datos, grupo_prioritario: b.get('grupo_prioritario') || null,
        consentimiento_postular: b.get('consentimiento_postular') === 'si', consentimiento_banco: b.get('consentimiento_banco') === 'si', canal: 'portal' });
      c.sess.personaId = r.persona_id;
      c.redirect('/mis-postulaciones/panel', { tipo: 'ok', msg: `Postulación recibida. Le enviamos el Aviso 1 por correo. Su código de seguimiento es ${r.codigo}: guárdelo para consultar el estado.` });
    } catch (e) {
      if (e instanceof E.ReglaError) return c.redirect(`/ofertas/${o.codigo}#postular`, { tipo: 'error', regla: e.regla, msg: e.message, datos });
      throw e;
    }
  });

  route('GET', '/privacidad', (c) => c.send(200, publicLayout({
    title: 'Aviso de privacidad',
    body: html`<h1>Aviso de privacidad</h1>
<p class="note">Borrador para revisión de Asesoría Jurídica (sección 10.1 del informe).</p>
<h2>Responsable</h2><p>I. Municipalidad de Casablanca, Oficina Municipal de Información Laboral (OMIL), Chacabuco N°440.</p>
<h2>Finalidades</h2><ul><li>Gestionar su postulación: registro, clasificación según requisitos objetivos, envío al empleador e información del resultado (base de licitud: su consentimiento y la función pública de intermediación laboral).</li>
<li>Banco de futuras ofertas: solo con un consentimiento específico, separado y revocable (RN-18).</li>
<li>Estadísticas agregadas y anonimizadas para el Concejo Municipal y SENCE. Nunca se publican datos personales (RN-17).</li></ul>
<h2>Datos que tratamos</h2><p>RUT, nombre, correo, teléfono, comuna y la evaluación de requisitos. La pertenencia a un grupo prioritario es voluntaria, se trata como dato sensible y solo se usa para el indicador SENCE.</p>
<h2>Plazo de conservación</h2><p>24 meses desde el cierre del proceso (propuesta sujeta a decreto), salvo consentimiento vigente para futuras ofertas o expediente congelado por una denuncia.</p>
<h2>Sus derechos</h2><p>Acceso, rectificación, supresión, oposición, portabilidad y bloqueo. Puede ejercerlos en <a href="/mis-postulaciones">Mis postulaciones</a>, presencialmente o en omilpersonas@municipalidadcasablanca.cl.</p>`,
  })));

  // ---------- M1: mis postulaciones (CU-12) ----------
  route('GET', '/mis-postulaciones', (c) => {
    if (c.sess.personaId) return c.redirect('/mis-postulaciones/panel');
    c.send(200, publicLayout({
      title: 'Mis postulaciones', flash: c.flash,
      body: html`<h1>Mis postulaciones</h1>
<p>Ingrese su RUT y el código de seguimiento que recibió en el correo de confirmación (Aviso 1).</p>
<form method="post" action="/mis-postulaciones/ingresar" class="form card">
  ${field('RUT', raw('<input name="rut" required autocomplete="off" placeholder="12.345.678-9" inputmode="text">'))}
  ${field('Código de seguimiento', raw('<input name="codigo" required autocomplete="off" placeholder="Ej: 4F9A21C0" style="text-transform:uppercase">'))}
  <button class="btn">Ingresar</button>
</form>
<p class="muted">¿Perdió su código? Acérquese a la OMIL (Chacabuco N°440) o llame al 32 2277406.</p>`,
    }));
  });
  route('POST', '/mis-postulaciones/ingresar', (c) => {
    const p = q.get('SELECT * FROM personas WHERE rut=? AND codigo_seguimiento=? AND anonimizada=0', E.normRut(c.body.get('rut')), (c.body.get('codigo') || '').trim().toUpperCase());
    if (!p) return c.redirect('/mis-postulaciones', { tipo: 'error', msg: 'RUT o código incorrecto.' });
    c.sess.personaId = p.id;
    c.redirect('/mis-postulaciones/panel');
  });
  route('GET', '/mis-postulaciones/salir', (c) => { delete c.sess.personaId; c.redirect('/'); });

  route('GET', '/mis-postulaciones/panel', (c) => {
    const pe = c.sess.personaId && q.get('SELECT * FROM personas WHERE id=? AND anonimizada=0', c.sess.personaId);
    if (!pe) return c.redirect('/mis-postulaciones');
    const posts = q.all(`SELECT p.*, o.cargo, o.codigo, o.fecha_derivacion, e.razon_social FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id
      JOIN empleadores e ON e.id=o.empleador_id WHERE p.persona_id=? ORDER BY p.id DESC`, pe.id);
    const cons = q.all('SELECT * FROM consentimientos WHERE persona_id=? ORDER BY id', pe.id);
    const banco = cons.find((x) => x.tipo === 'banco_futuras' && x.estado === 'vigente');
    const sol = q.all('SELECT * FROM solicitudes_titular WHERE persona_id=? ORDER BY id DESC', pe.id);
    c.send(200, publicLayout({
      title: 'Mis postulaciones', flash: c.flash,
      body: html`<div class="row-between"><h1>Hola, ${pe.nombre.split(' ')[0]}</h1><a class="btn btn-ghost btn-sm" href="/mis-postulaciones/salir">Salir</a></div>
${posts.map((p) => {
    const avisos = q.all(`SELECT tipo, asunto, enviado_at FROM avisos WHERE postulacion_id=? ORDER BY id`, p.id);
    return html`<article class="card post">
  <div class="row-between"><h2>${p.cargo}</h2>${badge(E.ESTADO_POST_PUBLICO[p.estado], ['seleccionada'].includes(p.estado) ? 'ok' : ['derivada'].includes(p.estado) ? 'accent' : 'muted')}</div>
  <p class="muted">${p.razon_social} · postulación del ${fmtDate(toDate(p.creado_at))} · ${p.codigo}</p>
  ${['recibida', 'clasificada'].includes(p.estado) ? html`<p>Enviaremos sus antecedentes al empleador el <strong>${fmtDate(p.fecha_derivacion)}</strong>.</p>` : ''}
  <ol class="timeline">${avisos.map((a) => html`<li><time>${fmtDateTime(a.enviado_at)}</time> ${a.asunto}</li>`)}</ol>
  ${['recibida', 'clasificada', 'derivada'].includes(p.estado) ? html`<form method="post" action="/mis-postulaciones/retirar" onsubmit="return confirm('¿Retirar esta postulación?')">
    <input type="hidden" name="id" value="${p.id}"><button class="btn btn-ghost btn-sm">Retirar postulación</button></form>` : ''}
</article>`;
  })}
<section class="card">
  <h2>Banco de futuras ofertas</h2>
  ${banco ? html`<p>Usted autorizó el ${fmtDate(toDate(banco.otorgado_at))} que mantengamos sus antecedentes para futuras ofertas.</p>
    <form method="post" action="/mis-postulaciones/consentimiento"><input type="hidden" name="accion" value="revocar"><button class="btn btn-ghost btn-sm">Revocar autorización</button></form>`
    : html`<p>Sus antecedentes no están en el banco de futuras ofertas.</p><p class="muted">${TXT_BANCO}</p>
    <form method="post" action="/mis-postulaciones/consentimiento"><input type="hidden" name="accion" value="otorgar"><button class="btn btn-sm">Autorizar</button></form>`}
</section>
<section class="card">
  <h2>Mis datos y derechos</h2>
  <p>RUT ${pe.rut} · ${pe.correo || 'sin correo'} · ${pe.telefono || 'sin teléfono'} · ${pe.comuna || ''}</p>
  <form method="post" action="/mis-postulaciones/derechos" class="form">
    ${field('¿Qué desea solicitar?', sel('tipo', [['acceso', 'Acceso a mis datos'], ['rectificacion', 'Rectificar un dato'], ['supresion', 'Suprimir mis datos'], ['oposicion', 'Oponerme a un tratamiento'], ['portabilidad', 'Portabilidad'], ['bloqueo', 'Bloqueo temporal']]))}
    ${field('Detalle', raw('<textarea name="detalle" rows="2"></textarea>'))}
    <button class="btn btn-sm">Enviar solicitud</button>
  </form>
  ${sol.length ? table(['Solicitud', 'Fecha', 'Plazo de respuesta', 'Estado'], sol.map((s) => [s.tipo, fmtDate(toDate(s.fecha)), fmtDate(s.plazo), s.estado + (s.respuesta ? ` — ${s.respuesta}` : '')])) : ''}
</section>`,
    }));
  });
  const persona = (c) => c.sess.personaId || (() => { throw new E.ReglaError('—', 'Su sesión expiró'); })();
  route('POST', '/mis-postulaciones/retirar', (c) => { E.retirarPostulacion(persona(c), Number(c.body.get('id'))); c.redirect('/mis-postulaciones/panel', { tipo: 'ok', msg: 'Postulación retirada.' }); });
  route('POST', '/mis-postulaciones/consentimiento', (c) => {
    if (c.body.get('accion') === 'revocar') E.revocarConsentimiento(persona(c), 'banco_futuras'); else E.otorgarBanco(persona(c));
    c.redirect('/mis-postulaciones/panel', { tipo: 'ok', msg: 'Preferencia actualizada.' });
  });
  route('POST', '/mis-postulaciones/derechos', (c) => {
    E.solicitudTitular(persona(c), c.body.get('tipo'), c.body.get('detalle'));
    c.redirect('/mis-postulaciones/panel', { tipo: 'ok', msg: `Solicitud registrada. La responderemos dentro de ${E.PARAM.diasPlazoTitular} días.` });
  });

  // ---------- M2: canal del empleador ----------
  route('GET', '/empleadores/publicar', (c) => c.send(200, publicLayout({
    title: 'Publicar una oferta', flash: c.flash,
    body: html`<h1>Publicar una oferta en la OMIL</h1>
<p>La publicación es gratuita. Revisamos que los requisitos sean objetivos y no discriminatorios antes de publicar.</p>
<form method="post" action="/empleadores/publicar" class="form">
  ${formOferta({ publico: true })}
  <fieldset class="card"><legend>Condición de servicio</legend>
    <label class="check"><input type="checkbox" name="acepta_condicion" value="si" required>
    <span>Me comprometo a <strong>informar el resultado del proceso</strong> (a quiénes contraté, o si quedó desierto) con el enlace que recibiré junto a la nómina. Si no lo informo dentro de 30 días corridos desde la derivación, la OMIL cerrará el proceso y avisará a los postulantes; y durante 12 meses mis nuevas ofertas requerirán autorización de la jefatura OMIL.</span></label>
  </fieldset>
  <button class="btn">Enviar oferta a validación</button>
</form>`,
  })));
  route('POST', '/empleadores/publicar', (c) => {
    const d = leerOferta(c.body);
    const empleador_id = E.registrarEmpleador(d.empleador, 'empleador');
    const id = E.crearOferta({ ...d.oferta, empleador_id }, d.empleador.razon_social || 'empleador');
    const o = E.getOferta(id);
    c.redirect('/', { tipo: 'ok', msg: `Recibimos su oferta ${o.codigo}. La OMIL la revisará y le confirmará por correo las fechas de postulación y derivación.${o.requiere_autorizacion ? ' Nota: por tener una oferta cerrada sin resultado informado en los últimos 12 meses, requiere autorización de la jefatura (RN-09).' : ''}` });
  });

  // Enlace único del empleador: declaraciones (P4), nómina y resultado (CU-08, CU-11)
  route('GET', '/e/:token', (c) => {
    const der = q.get('SELECT * FROM derivaciones WHERE token=?', c.params.token);
    if (!der) return c.send(404, publicLayout({ title: 'Enlace no válido', body: html`<h1>Enlace no válido</h1>` }));
    const o = E.getOferta(der.oferta_id);
    const res = E.resultadoVigente(o.id);
    const nomina = JSON.parse(der.nomina_json);
    const dec = o.municipal ? E.estadoDeclaracionesEntrevistadores(o.id) : { completo: true, lista: [] };
    const dias = calendarDaysBetween(toDate(o.derivada_at || der.fecha), today());
    const vence = addDays(toDate(o.derivada_at || der.fecha), E.PARAM.diasCierreAuto);
    let cuerpo;
    if (o.estado !== 'derivada') cuerpo = html`<div class="flash flash-info">Este proceso está cerrado: ${E.ESTADO_OFERTA[o.estado]}. Gracias.</div>`;
    else if (res) cuerpo = html`<div class="flash flash-ok">Recibimos su resultado el ${fmtDateTime(res.fecha_informe)}. La OMIL lo validará y avisará a los postulantes.</div>`;
    else cuerpo = html`
${o.municipal ? html`<section class="card">
  <h2>1. Declaración de vínculos <small class="muted">(RN-10 · Ley N°19.880 art. 12)</small></h2>
  <p>Antes de ver la nómina, cada persona que entrevistará debe declarar si tiene parentesco o relación con algún postulante. Quien declare un vínculo queda inhabilitado para esta oferta y la jefatura OMIL designa un reemplazo.</p>
  ${table(['Entrevistador/a', 'Declaración'], dec.lista.map((e) => [e.nombre, e.decl ? (e.decl.declara_vinculo ? badge('Declaró vínculo · abstención registrada · pendiente reemplazo', 'danger') : badge(`Firmada ${fmtDate(toDate(e.decl.fecha))}`, 'ok')) : badge('Pendiente', 'warn')]))}
  ${dec.lista.some((e) => !e.decl) ? html`<form method="post" action="/e/${c.params.token}/declaracion" class="form">
    ${field('Entrevistador/a', sel('entrevistador_id', dec.lista.filter((e) => !e.decl).map((e) => [e.id, e.nombre])))}
    <details><summary>Ver lista de postulantes para declarar</summary><ul class="cols">${nomina.map((n) => html`<li>${n.nombre}</li>`)}</ul></details>
    <fieldset><legend>¿Tiene parentesco o relación con alguno de los postulantes?</legend>
      <label class="check"><input type="radio" name="vinculo" value="no" checked> No tengo vínculo con ningún postulante</label>
      <label class="check"><input type="radio" name="vinculo" value="si"> Sí, declaro vínculo con:</label>
      ${sel('postulacion_id', [['', '— seleccione —'], ...nomina.map((n) => [n.postulacion_id, n.nombre])])}
      ${field('Tipo de vínculo', raw('<input name="detalle" placeholder="Ej: pariente, amistad, relación laboral">'))}
    </fieldset>
    ${field('Firma (nombre completo)', raw('<input name="firma" required>'), 'Firma simple. La plataforma definitiva integrará firma electrónica (FirmaGob).')}
    <button class="btn">Firmar declaración</button>
  </form>` : ''}
</section>` : ''}
${dec.completo ? html`<section class="card">
  <h2>${o.municipal ? '2. ' : ''}Nómina completa <span class="count">${nomina.length}</span></h2>
  <p class="muted">Huella de la nómina enviada: <code>${der.huella.slice(0, 16)}…</code> · <a href="/e/${c.params.token}/nomina.csv">Descargar CSV</a></p>
  ${table(['Postulante', 'RUT', 'Contacto', 'Clasificación', 'Requisitos'], nomina.map((n) => [n.nombre, n.rut, html`${n.correo || ''}<br>${n.telefono || ''}`, badgeClasif(n.clasificacion),
    html`<ul class="mini">${n.requisitos.map((r) => html`<li class="${r.resultado}">${r.descripcion}: ${r.resultado.replace('_', ' ')}</li>`)}</ul>`]))}
</section>
<section class="card">
  <h2>${o.municipal ? '3. ' : ''}Informar el resultado</h2>
  <form method="post" action="/e/${c.params.token}/resultado" class="form">
    <fieldset><legend>Resultado del proceso</legend>
      <label class="check"><input type="radio" name="tipo" value="contratacion" checked> Contraté a una o más personas de la nómina</label>
      <label class="check"><input type="radio" name="tipo" value="desierta"> El proceso quedó desierto (no contraté)</label>
      <label class="check"><input type="radio" name="tipo" value="anulada"> Retiro / anulo la oferta</label>
    </fieldset>
    <fieldset><legend>Personas contratadas</legend>
      ${nomina.map((n) => html`<label class="check"><input type="checkbox" name="contratados" value="${n.postulacion_id}"> ${n.nombre} ${badgeClasif(n.clasificacion)}</label>`)}
    </fieldset>
    ${o.municipal ? html`<fieldset class="acta"><legend>Acta de selección (obligatoria · RN-12)</legend>
      <p class="muted">Personas entrevistadas:</p>
      ${nomina.map((n) => html`<label class="check"><input type="checkbox" name="entrevistados" value="${n.postulacion_id}"> ${n.nombre}</label>`)}
      ${field('Criterio aplicado', raw('<textarea name="criterio" rows="2"></textarea>'))}
      ${field('Firmantes del acta', raw('<input name="firmantes" placeholder="Nombres de quienes firman">'))}
      ${field('Referencia del documento', raw('<input name="documento" placeholder="N° de acta o archivo">'))}
      ${field('Justificación si selecciona a alguien clasificado "no cumple" (RN-13)', raw('<textarea name="justificacion_no_cumple" rows="2"></textarea>'), 'El caso quedará marcado con prioridad para la revisión de la Dirección de Control.')}
    </fieldset>` : ''}
    ${field('Comentario (opcional)', raw('<textarea name="comentario" rows="2"></textarea>'))}
    <button class="btn">Enviar resultado</button>
  </form>
</section>` : html`<div class="flash flash-info">La nómina se habilitará cuando todos los entrevistadores hayan firmado su declaración sin vínculos.</div>`}`;
    c.send(200, publicLayout({
      title: `Resultado ${o.codigo}`, flash: c.flash, wide: true,
      body: html`<h1>${o.cargo}</h1><p class="muted">${o.razon_social} · ${o.codigo}</p>
${o.estado === 'derivada' && !res ? html`<p>Recibió la nómina el ${fmtDate(toDate(o.derivada_at))} (hace ${dias} días). <strong>Informe el resultado antes del ${fmtDate(vence)}</strong>; de lo contrario la oferta se cerrará automáticamente.</p>` : ''}
${cuerpo}`,
    }));
  });
  route('GET', '/e/:token/nomina.csv', (c) => {
    const der = q.get('SELECT * FROM derivaciones WHERE token=?', c.params.token);
    if (!der) return c.send(404, 'No encontrado', 'text/plain');
    const o = E.getOferta(der.oferta_id);
    if (o.municipal && !E.estadoDeclaracionesEntrevistadores(o.id).completo) return c.send(403, 'RN-10: faltan declaraciones de vínculos', 'text/plain; charset=utf-8');
    const rows = JSON.parse(der.nomina_json).map((n) => [n.nombre, n.rut, n.correo, n.telefono, n.comuna, n.clasificacion]);
    c.send(200, csv([['nombre', 'rut', 'correo', 'telefono', 'comuna', 'clasificacion'], ...rows]), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="nomina-${o.codigo}.csv"` });
  });
  route('POST', '/e/:token/declaracion', (c) => {
    const der = q.get('SELECT * FROM derivaciones WHERE token=?', c.params.token);
    if (!der) return c.redirect('/');
    const ent = q.get('SELECT * FROM entrevistadores WHERE id=? AND oferta_id=? AND activo=1', Number(c.body.get('entrevistador_id')), der.oferta_id);
    if (!ent) throw new E.ReglaError('P4', 'Entrevistador no válido');
    const vinc = c.body.get('vinculo') === 'si';
    E.declarar(der.oferta_id, { tipo: 'entrevistador', id: ent.id, nombre: ent.nombre, declara_vinculo: vinc, postulacion_relacionada_id: c.body.get('postulacion_id'), detalle: c.body.get('detalle'), firma: c.body.get('firma') }, `${ent.nombre} (entrevistador)`);
    c.back({ tipo: vinc ? 'info' : 'ok', msg: vinc ? 'Declaración firmada. Su abstención quedó registrada y la jefatura OMIL designará un reemplazo.' : 'Declaración firmada.' });
  });
  route('POST', '/e/:token/resultado', (c) => {
    const b = c.body;
    E.informarResultado(c.params.token, {
      tipo: b.get('tipo'), contratados: b.getAll('contratados'), comentario: b.get('comentario'),
      acta: { entrevistados: b.getAll('entrevistados'), criterio: b.get('criterio'), firmantes: b.get('firmantes'), documento: b.get('documento'), justificacion_no_cumple: b.get('justificacion_no_cumple') },
    }, 'empleador (enlace único)');
    c.back({ tipo: 'ok', msg: 'Gracias. Recibimos el resultado; la OMIL avisará a los postulantes.' });
  });
}

export function csv(rows) {
  return '﻿' + rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
}

function formPostular(o, datos = {}) {
  return html`<section id="postular" class="card">
<h2>Postular</h2>
<form method="post" action="/ofertas/${o.codigo}/postular" class="form">
  ${field('RUT', raw(`<input name="rut" required autocomplete="off" placeholder="12.345.678-9" value="${esc2(datos.rut)}">`))}
  ${field('Nombre completo', raw(`<input name="nombre" required autocomplete="name" value="${esc2(datos.nombre)}">`))}
  ${field('Correo electrónico', raw(`<input name="correo" type="email" autocomplete="email" value="${esc2(datos.correo)}">`), 'Le enviaremos aquí los avisos de su postulación.')}
  ${field('Teléfono', raw(`<input name="telefono" type="tel" autocomplete="tel" value="${esc2(datos.telefono)}">`))}
  ${field('Comuna', raw(`<input name="comuna" autocomplete="address-level2" value="${esc2(datos.comuna || 'Casablanca')}">`))}
  ${field('¿Pertenece a un grupo prioritario? (voluntario)', sel('grupo_prioritario', [['', 'Prefiero no informar'], ['discapacidad', 'Persona con discapacidad'], ['mayor_50', 'Persona mayor de 50 años'], ['joven', 'Joven entre 18 y 24 años'], ['otro', 'Otro grupo prioritario SENCE']]),
    'Dato sensible: solo se usa para el indicador SENCE y no se envía al empleador.')}
  <fieldset class="consent"><legend>Consentimientos</legend>
    <label class="check"><input type="checkbox" name="consentimiento_postular" value="si" required> <span><strong>Obligatorio.</strong> ${TXT_POSTULAR} <a href="/privacidad" target="_blank">Aviso de privacidad</a>.</span></label>
    <label class="check"><input type="checkbox" name="consentimiento_banco" value="si"> <span><strong>Voluntario.</strong> ${TXT_BANCO}</span></label>
  </fieldset>
  <button class="btn">Enviar postulación</button>
</form></section>`;
}
const esc2 = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const CATEGORIAS = [['formacion', 'Formación'], ['experiencia', 'Experiencia'], ['licencia', 'Licencia'], ['certificacion', 'Certificación'], ['otro', 'Otro']];
export const DIRECCIONES = [['DOM', 'Dirección de Obras Municipales'], ['DIDECO', 'Dirección de Desarrollo Comunal'], ['DAF', 'Dirección de Administración y Finanzas'],
  ['DIMAO', 'Dirección de Medio Ambiente, Aseo y Ornato'], ['DTRANSITO', 'Dirección de Tránsito'], ['SECPLAN', 'Secretaría Comunal de Planificación']];

export function formOferta({ publico = false, empleadores = [], ejecutivos = [], o = null, reqs = [] } = {}) {
  const filasReq = Math.max(5, reqs.length + 2);
  return html`
${!o ? html`<fieldset class="card"><legend>Empleador</legend>
  ${!publico && empleadores.length ? field('Empleador registrado', sel('empleador_id', [['', '— nuevo empleador (complete abajo) —'], ...empleadores.map((e) => [e.id, `${e.razon_social}${e.estado_cumplimiento !== 'al_dia' ? ' · sin resultado informado' : ''}`])]), 'Si elige uno, se ignoran los datos de abajo.') : ''}
  ${field('Tipo de empleador', sel('tipo', [['privado', 'Empresa o persona natural'], ['municipal', 'Dirección municipal (empleador interno)']]))}
  <div class="grid2">
    ${field('RUT', raw('<input name="emp_rut" placeholder="76.543.210-K">'), 'No aplica a Direcciones municipales.')}
    ${field('Dirección municipal', sel('sigla', [['', '—'], ...DIRECCIONES]), 'Solo si es empleador interno.')}
  </div>
  ${field('Razón social o nombre', raw('<input name="razon_social">'))}
  <div class="grid2">
    ${field('Nombre de contacto', raw('<input name="contacto_nombre">'))}
    ${field('Correo de contacto', raw('<input name="contacto_correo" type="email">'))}
  </div>
  ${field('Teléfono', raw('<input name="emp_telefono" type="tel">'))}
</fieldset>` : ''}
<fieldset class="card"><legend>Descriptor del cargo</legend>
  ${field('Cargo', raw(`<input name="cargo" required value="${esc2(o?.cargo)}">`))}
  <div class="grid2">
    ${field('Área', raw(`<input name="area" value="${esc2(o?.area)}" placeholder="Agroindustria, Comercio…">`))}
    ${field('Vacantes', raw(`<input name="vacantes" type="number" min="1" value="${esc2(o?.vacantes || 1)}">`))}
  </div>
  ${field('Funciones', raw(`<textarea name="funciones" rows="3">${esc2(o?.funciones)}</textarea>`))}
  <div class="grid2">
    ${field('Jornada', raw(`<input name="jornada" value="${esc2(o?.jornada)}">`))}
    ${field('Renta', raw(`<input name="renta" value="${esc2(o?.renta)}">`))}
  </div>
  ${field('Condiciones', raw(`<textarea name="condiciones" rows="2">${esc2(o?.condiciones)}</textarea>`))}
  ${!publico && !o && ejecutivos.length ? field('Ejecutivo/a asignado', sel('ejecutivo_id', [['', 'Asignar al de menor carga'], ...ejecutivos.map((u) => [u.id, u.nombre])])) : ''}
</fieldset>
<fieldset class="card"><legend>Requisitos objetivos</legend>
  <p class="muted">Marque como <strong>excluyente</strong> solo lo indispensable: determina la clasificación "cumple / no cumple". No se aceptan requisitos que discriminen por sexo, edad, estado civil u otra condición prohibida por el art. 2 del Código del Trabajo.</p>
  ${Array.from({ length: filasReq }, (_, i) => {
    const r = reqs[i] || {};
    return html`<div class="reqrow">
      <input name="req_desc" aria-label="Requisito ${i + 1}" placeholder="Requisito ${i + 1}" value="${esc2(r.descripcion)}">
      ${sel('req_tipo', [['excluyente', 'Excluyente'], ['deseable', 'Deseable']], r.tipo, `aria-label="Tipo del requisito ${i + 1}"`)}
      ${sel('req_cat', CATEGORIAS, r.categoria, `aria-label="Categoría del requisito ${i + 1}"`)}
    </div>`;
  })}
</fieldset>
${!o ? html`<fieldset class="card"><legend>Entrevistadores (solo Direcciones municipales)</legend>
  <p class="muted">Indique quiénes participarán en la entrevista. Cada uno deberá declarar vínculos antes de ver la nómina.</p>
  ${[0, 1, 2].map((i) => html`<div class="grid2"><input name="ent_nombre" aria-label="Nombre entrevistador ${i + 1}" placeholder="Nombre entrevistador/a ${i + 1}"><input name="ent_correo" type="email" aria-label="Correo entrevistador ${i + 1}" placeholder="Correo"></div>`)}
</fieldset>` : ''}`;
}

export function leerOferta(b) {
  const desc = b.getAll('req_desc'), tipo = b.getAll('req_tipo'), cat = b.getAll('req_cat');
  const en = b.getAll('ent_nombre'), ec = b.getAll('ent_correo');
  return {
    empleador: { rut: b.get('emp_rut'), sigla: b.get('sigla'), razon_social: b.get('razon_social') || (DIRECCIONES.find(([s]) => s === b.get('sigla'))?.[1]), tipo: b.get('tipo'),
      contacto_nombre: b.get('contacto_nombre'), contacto_correo: b.get('contacto_correo'), telefono: b.get('emp_telefono'), acepta_condicion: b.get('acepta_condicion') === 'si' },
    oferta: { cargo: b.get('cargo'), area: b.get('area'), vacantes: b.get('vacantes'), funciones: b.get('funciones'), jornada: b.get('jornada'), renta: b.get('renta'), condiciones: b.get('condiciones'),
      ejecutivo_id: b.get('ejecutivo_id') ? Number(b.get('ejecutivo_id')) : undefined,
      requisitos: desc.map((d, i) => ({ descripcion: d, tipo: tipo[i], categoria: cat[i] })),
      entrevistadores: en.map((n, i) => ({ nombre: n, correo: ec[i] })) },
  };
}
