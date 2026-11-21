// Back-office de funcionarios: gestión de ofertas (M3–M6), probidad (M8), auditoría (M9),
// reportería (M10), plantillas (M7) y administración / datos personales (M14).
import { q } from './db.js';
import * as E from './engine.js';
import { log, verifyChain } from './audit.js';
import { nuevaVersionPlantilla, plantillaVigente, send, reencolar, marcarRebotado } from './notify.js';
import { resumenCorreo, ESTADOS_AVISO, direccionValida } from './correo-config.js';
import { informeTrimestral, panel, indicadores, trimestreActual, sup } from './reports.js';
import { today, toDate, fmtDate, fmtDateTime, addDays, calendarDaysBetween, setOffsetDays, offsetDays, invalidateFeriados } from './clock.js';
import { staffLayout, gateLayout, flash, icon, html, raw, table, kpi, field, sel, badge, badgeOferta, badgePost, badgeClasif, ROLES, esc } from './views.js';
import { formOferta, leerOferta, csv } from './routes-public.js';

const TONO_AVISO = { pendiente: 'info', entregado: 'ok', rebotado: 'danger', error: 'danger', retenido: 'warn', interno: 'accent' };
const badgeAviso = (e) => badge(ESTADOS_AVISO[e] || e, TONO_AVISO[e]);
const deny = (c) => c.send(403, staffLayout({ title: 'Sin permiso', user: c.user, path: c.url.pathname, body: html`<h1>Sin permiso</h1><p>Su rol (${ROLES[c.user.rol]}) no tiene acceso a esta función según la matriz de permisos (5.3).</p>` }));
function guard(roles, h) {
  return (c) => {
    if (!c.user) return c.redirect(`/login?volver=${encodeURIComponent(c.url.pathname)}`);
    if (roles && !roles.includes(c.user.rol)) return deny(c);
    return h(c);
  };
}
const render = (c, title, body) => c.send(200, staffLayout({ title, user: c.user, path: c.url.pathname, body, flash: c.flash }));
const STAFF_OFERTAS = ['ejecutivo', 'jefatura', 'control'];
const GESTION = ['ejecutivo', 'jefatura'];

export function staffRoutes(route) {
  // ---------- sesión ----------
  route('GET', '/login', (c) => {
    const users = q.all(`SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN 'jefatura' THEN 1 WHEN 'ejecutivo' THEN 2 WHEN 'control' THEN 3
      WHEN 'dideco' THEN 4 WHEN 'dpo' THEN 5 ELSE 6 END, nombre`);
    c.send(200, gateLayout({ title: 'Acceso', body: html`
${flash(c.flash)}
<form method="post" action="/login" class="gate-card">
  <div class="func-badge">${icon('datos')}Acceso municipal</div>
  <h2>Funcionarios municipales</h2>
  <p>Ingresa con tus credenciales institucionales. El acceso lo asigna el administrador del sistema.</p>
  <input type="hidden" name="volver" value="${c.url.searchParams.get('volver') || '/app'}">
  <div class="login-field"><label for="u">Usuario (demo)</label>${sel('user_id', users.map((u) => [u.id, `${u.nombre} — ${ROLES[u.rol]}`]), '', 'id="u"')}</div>
  <button class="login-primary">Ingresar</button>
  <div class="login-note-sec">En producción: cuenta institucional con doble factor (requisito 7.6.8).</div>
  <div class="gate-funcionario"><a href="/">← Portal de ofertas para postulantes</a></div>
</form>
<div class="gate-demo"><div class="gate-demo-lbl">Explorar prototipo (demo)</div><div class="gate-demo-pills">
  ${users.filter((u, i, arr) => arr.findIndex((x) => x.rol === u.rol) === i).map((u) => html`<button form="demo" name="user_id" value="${u.id}">${{ jefatura: 'Jefatura', ejecutivo: 'Ejecutivo', control: 'Control', dideco: 'DIDECO', dpo: 'Datos', admin: 'Admin' }[u.rol]}</button>`)}
</div></div>
<form id="demo" method="post" action="/login"><input type="hidden" name="volver" value="/app"></form>
<div class="gate-note">Ilustre Municipalidad de Casablanca · OMIL</div>` }));
  });
  route('POST', '/login', (c) => {
    const u = q.get('SELECT * FROM usuarios WHERE id=? AND activo=1', Number(c.body.get('user_id')));
    if (!u) return c.redirect('/login', { tipo: 'error', msg: 'Usuario no válido' });
    c.sess.userId = u.id;
    log({ usuario: `${u.nombre} (${u.rol})`, entidad: 'usuario', entidad_id: u.id, accion: 'inicio de sesión' });
    const v = c.body.get('volver') || '/app';
    c.redirect(v.startsWith('/app') ? v : '/app');
  });
  route('GET', '/logout', (c) => { delete c.sess.userId; c.redirect('/login'); });

  route('POST', '/app/reloj', guard(['jefatura', 'admin'], (c) => {
    const d = c.body.get('dias');
    if (d === 'reset') setOffsetDays(0); else setOffsetDays(offsetDays() + Number(d || 1));
    const r = E.tick();
    log({ usuario: `${c.user.nombre} (${c.user.rol})`, entidad: 'sistema', accion: `reloj simulado ${d === 'reset' ? 'restablecido' : `+${d} días`}` });
    const resumen = Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
    c.redirect(c.body.get('volver') || '/app', { tipo: 'info', msg: `Fecha del sistema: ${fmtDate(today())}. Temporizadores: ${resumen || 'sin eventos'}.` });
  }));

  // ---------- panel (7.5) ----------
  route('GET', '/app', guard(null, (c) => {
    const u = c.user;
    if (['control', 'dideco', 'admin', 'dpo'].includes(u.rol)) return render(c, 'Panel', panelOtros(u));
    const p = panel(u);
    const pendRes = p.pendientes.filter((o) => o.res && !o.res.validado_at);
    render(c, 'Panel', html`
<h1>Panel de gestión</h1>
<div class="kpis">
  ${kpi('Ofertas por validar', p.enValidacion.length, p.enValidacion.length ? 'warn' : '', '#validar')}
  ${kpi('Postulaciones sin clasificar', p.sinClasificar.reduce((s, x) => s + x.n, 0), '', '#clasificar')}
  ${kpi('Esperando resultado del empleador', p.pendientes.filter((o) => !o.res).length, '', '#pendientes')}
  ${kpi('Resultados por validar (Aviso 3)', pendRes.length, pendRes.length ? 'danger' : '', '#pendientes')}
  ${kpi('Avisos no entregados', p.rebotados.length, p.rebotados.length ? 'warn' : '', '#rebotes')}
</div>
${p.alertas.length ? html`<section class="card"><h2>Alertas para usted</h2><ul class="alerts">${p.alertas.map((a) => html`<li><time>${fmtDateTime(a.enviado_at)}</time> <a href="/app/ofertas/${a.oferta_id}">${a.asunto}</a></li>`)}</ul></section>` : ''}
${p.abstenciones.length && u.rol === 'jefatura' ? html`<section class="card warnbox"><h2>Abstenciones pendientes de reemplazo (RN-11)</h2>
  ${table(['Oferta', 'Quién declaró vínculo', 'Fecha', ''], p.abstenciones.map((d) => [html`${d.codigo} · ${d.cargo}`, d.nombre, fmtDate(toDate(d.fecha)), html`<a href="/app/ofertas/${d.oferta_id}#probidad">Asignar reemplazo</a>`]))}</section>` : ''}
<section id="validar"><h2>Ofertas en validación</h2>
${table(['Código', 'Cargo', 'Empleador', 'Ingreso', 'Estado', ''], p.enValidacion.map((o) => [o.codigo, o.cargo, o.razon_social, fmtDate(toDate(o.creado_at)),
    html`${badgeOferta(o.estado)} ${o.requiere_autorizacion && !o.autorizada_por ? badge('Requiere autorización RN-09', 'danger') : ''} ${E.requisitosObjetables(o.id).length ? badge('Requisito objetable', 'danger') : ''}`, html`<a href="/app/ofertas/${o.id}">Revisar</a>`]), 'Nada por validar')}</section>
<section id="clasificar"><h2>Postulaciones sin clasificar</h2>
${table(['Oferta', 'Cargo', 'Sin clasificar', ''], p.sinClasificar.map((x) => [x.codigo, x.cargo, x.n, html`<a href="/app/ofertas/${x.id}#postulaciones">Clasificar</a>`]), 'Todo clasificado')}</section>
<section><h2>Ofertas que cierran postulación en los próximos 3 días hábiles</h2>
${table(['Código', 'Cargo', 'Empleador', 'Cierre', 'Derivación'], p.porVencer.map((o) => [html`<a href="/app/ofertas/${o.id}">${o.codigo}</a>`, o.cargo, o.razon_social, fmtDate(o.fecha_cierre_postulacion), fmtDate(o.fecha_derivacion)]), 'Ninguna')}</section>
<section id="pendientes"><h2>Resultados pendientes por empleador</h2>
${table(['Código', 'Cargo', 'Empleador', 'Días desde derivación', 'Situación'], p.pendientes.map((o) => [html`<a href="/app/ofertas/${o.id}">${o.codigo}</a>`, o.cargo, o.razon_social,
    html`<span class="${o.dias >= 20 ? 'txt-danger' : o.dias >= 10 ? 'txt-warn' : ''}">${o.dias} / 30</span>`,
    o.res ? (o.res.validado_at ? '—' : badge('Resultado recibido · validar y cerrar', 'danger')) : `Recordatorios: ${[o.recordatorio10 && 'día 10', o.recordatorio20 && 'día 20'].filter(Boolean).join(', ') || 'ninguno aún'}`]), 'Ninguno')}</section>
${u.rol === 'jefatura' ? html`<section><h2>Carga por ejecutivo/a</h2>
${table(['Ejecutivo/a', 'En validación', 'Publicadas', 'Derivadas', 'Postulaciones sin clasificar'], p.carga.map((x) => [x.nombre, x.val || 0, x.pub || 0, x.der || 0, x.sin_clasif]))}</section>` : ''}
<section id="rebotes"><h2>Avisos no entregados</h2>
${table(['Fecha', 'Aviso', 'Oferta', 'Destinatario', 'Estado'], p.rebotados.map((a) => [fmtDateTime(a.enviado_at), a.tipo, a.codigo || '—', a.destinatario, html`${badgeAviso(a.estado_entrega)}${a.ultimo_error ? html`<br><small>${a.ultimo_error}</small>` : ''}`]), 'Sin avisos pendientes de gestión')}
<p class="muted">Un aviso rebotado debe contactarse por teléfono y corregir el correo en la ficha de la persona. Los avisos con error o retenidos se reintentan desde <a href="/app/avisos?entrega=error">Avisos</a>.</p></section>`);
  }));

  // ---------- ofertas ----------
  route('GET', '/app/ofertas', guard(STAFF_OFERTAS, (c) => {
    const est = c.url.searchParams.get('estado') || '';
    const mias = c.url.searchParams.get('mias') === '1';
    const rows = q.all(`SELECT o.*, e.razon_social, u.nombre ej, (SELECT COUNT(*) FROM postulaciones p WHERE p.oferta_id=o.id) n
      FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id LEFT JOIN usuarios u ON u.id=o.ejecutivo_id
      WHERE (?='' OR o.estado=?) AND (?=0 OR o.ejecutivo_id=?) ORDER BY o.id DESC`, est, est, mias ? 1 : 0, c.user.id);
    render(c, 'Ofertas', html`
<div class="row-between"><h1>Ofertas</h1>${GESTION.includes(c.user.rol) ? html`<a class="btn" href="/app/ofertas/nueva">Nueva oferta</a>` : ''}</div>
<form class="filters" method="get">
  ${sel('estado', [['', 'Todos los estados'], ...Object.entries(E.ESTADO_OFERTA)], est)}
  ${c.user.rol === 'ejecutivo' ? html`<label class="check"><input type="checkbox" name="mias" value="1" ${mias ? raw('checked') : ''}> Solo mis ofertas</label>` : ''}
  <button class="btn btn-ghost btn-sm">Filtrar</button>
</form>
${table(['Código', 'Cargo', 'Empleador', 'Ejecutivo/a', 'Postulaciones', 'Estado', 'Hito'], rows.map((o) => [
    html`<a href="/app/ofertas/${o.id}">${o.codigo}</a>`, html`${o.cargo}${o.municipal ? html` ${badge('Municipal', 'accent')}` : ''}`, o.razon_social, o.ej || '—', o.n, badgeOferta(o.estado),
    o.estado === 'publicada' ? `Cierra ${fmtDate(o.fecha_cierre_postulacion)}` : o.estado === 'derivada' ? `Día ${calendarDaysBetween(toDate(o.derivada_at), today())} de 30` : o.cerrada_at ? `Cerrada ${fmtDate(toDate(o.cerrada_at))}` : '']))}`);
  }));

  route('GET', '/app/ofertas/nueva', guard(GESTION, (c) => render(c, 'Nueva oferta', html`
<h1>Registrar oferta (CU-02)</h1>
<p class="muted">Para ofertas recibidas presencialmente o por correo. Los empleadores también pueden ingresarlas en <a href="/empleadores/publicar">el formulario público</a>.</p>
<form method="post" action="/app/ofertas" class="form">
  ${formOferta({ empleadores: q.all('SELECT * FROM empleadores ORDER BY razon_social'), ejecutivos: q.all(`SELECT * FROM usuarios WHERE rol='ejecutivo' AND activo=1`) })}
  <label class="check"><input type="checkbox" name="acepta_condicion" value="si"> El empleador nuevo aceptó la condición de servicio (informar el resultado)</label>
  <button class="btn">Registrar oferta</button>
</form>`)));
  route('POST', '/app/ofertas', guard(GESTION, (c) => {
    const d = leerOferta(c.body);
    const empleador_id = c.body.get('empleador_id') ? Number(c.body.get('empleador_id')) : E.registrarEmpleador(d.empleador, c.user);
    const id = E.crearOferta({ ...d.oferta, empleador_id }, c.user);
    c.redirect(`/app/ofertas/${id}`, { tipo: 'ok', msg: 'Oferta registrada en validación.' });
  }));

  route('GET', '/app/ofertas/:id', guard(STAFF_OFERTAS, (c) => render(c, 'Expediente', expediente(c, Number(c.params.id)))));

  const accion = (path, roles, fn, msg) => route('POST', `/app/ofertas/:id/${path}`, guard(roles, (c) => {
    const id = Number(c.params.id);
    const m = fn(c, id);
    c.redirect(`/app/ofertas/${id}${c.body.get('ancla') || ''}`, { tipo: 'ok', msg: m || msg });
  }));
  accion('publicar', GESTION, (c, id) => E.publicarOferta(id, { fecha_cierre: c.body.get('fecha_cierre') || undefined }, c.user), 'Oferta publicada. Se envió E1 al empleador con las fechas comprometidas.');
  accion('observar', GESTION, (c, id) => E.observarOferta(id, c.body.get('observacion'), c.user), 'Oferta observada y devuelta al empleador (E0).');
  accion('version', GESTION, (c, id) => E.nuevaVersionOferta(id, leerOferta(c.body).oferta, c.user), 'Nueva versión registrada; la oferta vuelve a validación.');
  accion('autorizar', ['jefatura'], (c, id) => E.autorizarOferta(id, c.user), 'Autorización registrada (RN-09).');
  accion('anular', GESTION, (c, id) => E.anularOferta(id, c.body.get('motivo'), c.user), 'Oferta anulada; se avisó a los postulantes.');
  accion('reasignar', ['jefatura'], (c, id) => E.reasignarEjecutivo(id, Number(c.body.get('ejecutivo_id')), c.user), 'Ejecutivo/a reasignado.');
  accion('declarar', GESTION, (c, id) => {
    const vinc = c.body.get('vinculo') === 'si';
    E.declarar(id, { tipo: 'usuario', id: c.user.id, nombre: c.user.nombre, declara_vinculo: vinc, postulacion_relacionada_id: c.body.get('postulacion_id'), detalle: c.body.get('detalle'), firma: c.body.get('firma') }, c.user);
    return vinc ? 'Declaró vínculo: quedó inhabilitado(a) para esta oferta y su abstención fue registrada. La jefatura debe reasignarla.' : 'Declaración firmada. Ya puede ver la nómina.';
  });
  accion('reemplazar', ['jefatura'], (c, id) => E.reemplazarEntrevistador(id, Number(c.body.get('entrevistador_id')), { nombre: c.body.get('nombre'), correo: c.body.get('correo') }, c.user), 'Reemplazo designado; debe firmar su declaración en el enlace de la Dirección.');
  accion('validar', GESTION, (c, id) => E.validarResultado(id, c.user), 'Resultado validado. Oferta cerrada y Aviso 3 enviado a los no seleccionados.');
  accion('reabrir', ['jefatura'], (c, id) => E.reabrirOferta(id, c.body.get('justificacion'), c.user), 'Oferta reabierta (RN-14) con nuevo plazo de 30 días.');
  accion('oirs', GESTION, (c, id) => E.vincularOIRS(id, c.body.get('caso'), c.user), 'Denuncia vinculada; el expediente queda congelado contra eliminación.');
  accion('liberar', ['jefatura'], (c, id) => E.liberarOIRS(id, c.user), 'Expediente liberado.');
  accion('bne', GESTION, (c, id) => E.marcarBNE(id, c.user), 'Registro en BNE marcado.');
  accion('postulacion', GESTION, (c, id) => {
    const acc = E.accesoFuncionario(E.getOferta(id), c.user);
    if (!acc.ok) throw new E.ReglaError('RN-10', acc.motivo);
    const b = c.body;
    const r = E.postular({ oferta_id: id, rut: b.get('rut'), nombre: b.get('nombre'), correo: b.get('correo'), telefono: b.get('telefono'), comuna: b.get('comuna'),
      consentimiento_postular: b.get('consentimiento_postular') === 'si', consentimiento_banco: b.get('consentimiento_banco') === 'si', canal: b.get('canal') }, c.user);
    return `Postulación registrada (CU-05). Código de seguimiento de la persona: ${r.codigo}. Se envió el Aviso 1.`;
  });

  // ---------- clasificación (CU-06) ----------
  route('GET', '/app/postulaciones/:id', guard(STAFF_OFERTAS, (c) => {
    const p = q.get(`SELECT p.*, pe.nombre, pe.rut, pe.correo, pe.telefono, pe.comuna, pe.anonimizada FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id WHERE p.id=?`, Number(c.params.id));
    if (!p) return c.redirect('/app/ofertas');
    const o = E.getOferta(p.oferta_id);
    const acc = E.accesoFuncionario(o, c.user);
    if (!acc.ok) return render(c, 'Sin acceso', html`<h1>Sin acceso</h1><div class="flash flash-error">${acc.motivo}</div><p><a href="/app/ofertas/${o.id}">Volver al expediente</a></p>`);
    const reqs = q.all(`SELECT r.*, e.resultado, e.motivo FROM requisitos r LEFT JOIN evaluaciones e ON e.requisito_id=r.id AND e.postulacion_id=? WHERE r.oferta_id=? ORDER BY r.tipo, r.id`, p.id, o.id);
    const editable = ['recibida', 'clasificada'].includes(p.estado) && !acc.soloLectura && GESTION.includes(c.user.rol);
    const cons = q.all('SELECT * FROM consentimientos WHERE persona_id=? ORDER BY id', p.persona_id);
    const avisos = q.all('SELECT * FROM avisos WHERE postulacion_id=? ORDER BY id', p.id);
    const bit = q.all(`SELECT * FROM bitacora WHERE entidad='postulacion' AND entidad_id=? ORDER BY id`, p.id);
    log({ usuario: `${c.user.nombre} (${c.user.rol})`, entidad: 'postulacion', entidad_id: p.id, oferta_id: o.id, accion: 'consulta de datos personales' });
    render(c, 'Postulación', html`
<p><a href="/app/ofertas/${o.id}#postulaciones">← ${o.codigo} · ${o.cargo}</a></p>
<div class="row-between"><h1>${p.nombre}</h1><div>${badgePost(p.estado)} ${badgeClasif(p.clasif_final)}</div></div>
<p class="muted">RUT ${p.rut || '—'} · ${p.correo || 'sin correo'} · ${p.telefono || 'sin teléfono'} · ${p.comuna || ''} · canal ${p.canal} · ${fmtDateTime(p.creado_at)}</p>
<section class="card"><h2>Lista de chequeo de requisitos</h2>
<form method="post" action="/app/postulaciones/${p.id}/clasificar" class="form">
  <div class="tablewrap"><table><thead><tr><th>Requisito</th><th>Tipo</th><th>Resultado</th><th>Motivo codificado si no acredita</th></tr></thead><tbody>
  ${reqs.map((r) => html`<tr><td>${r.descripcion}</td><td>${r.tipo === 'excluyente' ? badge('Excluyente', 'accent') : badge('Deseable', 'muted')}</td>
    <td>${editable ? sel(`res_${r.id}`, [['', '—'], ['acredita', 'Acredita'], ['no_acredita', 'No acredita'], ['no_informado', 'No informado']], r.resultado || '') : (r.resultado || '—')}</td>
    <td>${editable ? sel(`mot_${r.id}`, [['', '—'], ...Object.entries(E.MOTIVOS_NO_CUMPLE)], r.motivo || '') : (E.MOTIVOS_NO_CUMPLE[r.motivo] || '—')}</td></tr>`)}
  </tbody></table></div>
  ${p.clasif_calculada ? html`<p>Clasificación calculada (RN-01): ${badgeClasif(p.clasif_calculada)} ${p.justificacion_cambio ? html`· corregida a ${badgeClasif(p.clasif_final)} — <em>${p.justificacion_cambio}</em>` : ''}</p>` : ''}
  ${editable ? html`<details><summary>Corregir la clasificación calculada (RN-03)</summary>
    ${field('Clasificación final', sel('clasif_final', [['', 'Usar la calculada'], ['cumple', 'Cumple'], ['no_cumple', 'No cumple']]))}
    ${field('Justificación (queda en la bitácora)', raw('<textarea name="justificacion" rows="2"></textarea>'))}
  </details>
  <button class="btn">Guardar clasificación</button>` : html`<p class="muted">${acc.soloLectura ? 'Vista de solo lectura (Dirección de Control).' : 'La postulación ya fue derivada; la clasificación no se edita.'}</p>`}
</form></section>
<div class="grid2">
<section class="card"><h2>Consentimientos</h2>${table(['Tipo', 'Versión', 'Otorgado', 'Estado'], cons.map((x) => [x.tipo, x.version_texto, fmtDate(toDate(x.otorgado_at)), x.estado + (x.revocado_at ? ` ${fmtDate(toDate(x.revocado_at))}` : '')]))}</section>
<section class="card"><h2>Avisos a esta persona</h2>${table(['Fecha', 'Aviso', 'Entrega'], avisos.map((a) => [fmtDateTime(a.enviado_at), html`<span title="${a.cuerpo}">${a.tipo} · ${a.asunto}</span>`, badgeAviso(a.estado_entrega)]))}</section>
</div>
<section class="card"><h2>Bitácora de la postulación</h2>${bitacoraTable(bit)}</section>`);
  }));
  route('POST', '/app/postulaciones/:id/clasificar', guard(GESTION, (c) => {
    const id = Number(c.params.id);
    const p = q.get('SELECT * FROM postulaciones WHERE id=?', id);
    const evals = {};
    for (const r of q.all('SELECT id FROM requisitos WHERE oferta_id=?', p.oferta_id)) {
      const res = c.body.get(`res_${r.id}`);
      if (res) evals[r.id] = { resultado: res, motivo: c.body.get(`mot_${r.id}`) || null };
    }
    E.clasificar(id, evals, { clasif_final: c.body.get('clasif_final') || undefined, justificacion: c.body.get('justificacion') }, c.user);
    const sig = q.get(`SELECT id FROM postulaciones WHERE oferta_id=? AND estado='recibida' AND id!=? ORDER BY id LIMIT 1`, p.oferta_id, id);
    c.redirect(sig ? `/app/postulaciones/${sig.id}` : `/app/ofertas/${p.oferta_id}#postulaciones`, { tipo: 'ok', msg: `Clasificación guardada.${sig ? ' Siguiente postulación sin clasificar:' : ''}` });
  }));

  // ---------- empleadores ----------
  route('GET', '/app/empleadores', guard(GESTION, (c) => {
    const rows = q.all(`SELECT e.*, COUNT(o.id) n, SUM(o.estado='cerrada_sin_respuesta') sr, SUM(o.estado IN ('cerrada_con_resultado','desierta_anulada')) cr
      FROM empleadores e LEFT JOIN ofertas o ON o.empleador_id=e.id GROUP BY e.id ORDER BY e.razon_social`);
    render(c, 'Empleadores', html`<h1>Empleadores</h1>
${table(['Empleador', 'RUT', 'Tipo', 'Contacto', 'Ofertas', 'Con resultado', 'Sin respuesta', 'Cumplimiento'], rows.map((e) => [e.razon_social, e.rut.startsWith('MUNI-') ? '(municipal)' : e.rut, e.tipo, html`${e.contacto_nombre || ''}<br><small>${e.contacto_correo}</small>`, e.n, e.cr || 0, e.sr || 0,
    e.estado_cumplimiento === 'al_dia' ? badge('Al día', 'ok') : html`${badge('Sin resultado informado', 'danger')} ${E.requiereAutorizacion(e.id) ? html`<br><small>RN-09 vigente</small>` : ''}`]))}`);
  }));

  // ---------- avisos (cola y bandeja de salida, M7) ----------
  route('GET', '/app/avisos', guard(GESTION, (c) => {
    const tipo = c.url.searchParams.get('tipo') || '';
    const ent = c.url.searchParams.get('entrega') || '';
    const rows = q.all(`SELECT a.*, o.codigo FROM avisos a LEFT JOIN ofertas o ON o.id=a.oferta_id WHERE (?='' OR a.tipo=?) AND (?='' OR a.estado_entrega=?) ORDER BY a.id DESC LIMIT 300`, tipo, tipo, ent, ent);
    const tipos = q.all('SELECT DISTINCT tipo FROM avisos ORDER BY tipo').map((r) => [r.tipo, r.tipo]);
    const cuenta = Object.fromEntries(q.all('SELECT estado_entrega e, COUNT(*) n FROM avisos GROUP BY 1').map((r) => [r.e, r.n]));
    const rc = resumenCorreo();
    const atascados = (cuenta.error || 0) + (cuenta.retenido || 0);
    render(c, 'Avisos', html`<h1>Avisos</h1>
<p class="muted">Correo: <strong>${rc.modo === 'simulado' ? 'simulado (bandeja interna, no se envía)' : rc.destino}</strong> · entorno ${rc.entorno}${rc.redirigirA ? html` · <span class="chip c-warn">redirigido a ${rc.redirigirA}</span>` : ''}</p>
${rc.problemas.map((p) => html`<div class="flash flash-error">${p}</div>`)}
<div class="kpis">
  ${kpi('En cola', cuenta.pendiente || 0, '', '/app/avisos?entrega=pendiente')}
  ${kpi('Enviados', cuenta.entregado || 0, 'accent', '/app/avisos?entrega=entregado')}
  ${kpi('Rebotados', cuenta.rebotado || 0, cuenta.rebotado ? 'warn' : '', '/app/avisos?entrega=rebotado')}
  ${kpi('Con error o retenidos', atascados, atascados ? 'danger' : '', '/app/avisos?entrega=error')}
</div>
${atascados ? html`<form method="post" action="/app/avisos/reintentar" class="inline"><input type="hidden" name="todos" value="1"><button class="btn btn-sm">Reintentar ${atascados} aviso(s) con error o retenidos</button></form>` : ''}
<form class="filters" method="get">${sel('tipo', [['', 'Todos los avisos'], ...tipos], tipo)}${sel('entrega', [['', 'Todo estado'], ...Object.entries(ESTADOS_AVISO)], ent)}<button class="btn btn-ghost btn-sm">Filtrar</button></form>
${table(['Generado', 'Aviso', 'Oferta', 'Destinatario', 'Asunto', 'Estado', ''], rows.map((a) => [fmtDateTime(a.enviado_at), html`${a.tipo} <small>v${a.plantilla_version}</small>`, a.codigo || '—', a.destinatario,
    html`<details><summary>${a.asunto}</summary><pre class="mail">${a.cuerpo}</pre></details>`,
    html`${badgeAviso(a.estado_entrega)}${a.entregado_at && a.estado_entrega === 'entregado' ? html`<br><small class="mono">${fmtDateTime(a.entregado_at)}</small>` : ''}${a.intentos > 1 ? html`<br><small>${a.intentos} intentos</small>` : ''}${a.redirigido_a ? html`<br><small>→ ${a.redirigido_a}</small>` : ''}${a.ultimo_error ? html`<br><small class="txt-danger" style="font-weight:400">${a.ultimo_error}</small>` : ''}`,
    a.estado_entrega === 'entregado' ? html`<details><summary>Rebotó</summary><form method="post" action="/app/avisos/${a.id}/rebote" class="stack"><input name="motivo" placeholder="Motivo del aviso de no entrega" aria-label="Motivo"><button class="btn btn-ghost btn-sm">Marcar rebotado</button></form></details>`
      : ['error', 'retenido'].includes(a.estado_entrega) ? html`<form method="post" action="/app/avisos/reintentar"><input type="hidden" name="id" value="${a.id}"><button class="btn btn-ghost btn-sm">Reintentar</button></form>` : '']))}
<p class="note">Un aviso rebotado debe gestionarse por teléfono y corregirse el correo de la persona. Los avisos de no entrega que lleguen al buzón de la OMIL después del envío se registran con "Rebotó".</p>`);
  }));
  route('POST', '/app/avisos/reintentar', guard(['jefatura', 'ejecutivo', 'admin'], (c) => {
    const ids = c.body.get('todos') ? q.all(`SELECT id FROM avisos WHERE estado_entrega IN ('error','retenido')`).map((r) => r.id) : [Number(c.body.get('id'))];
    const n = reencolar(ids, `${c.user.nombre} (${c.user.rol})`);
    c.back({ tipo: 'ok', msg: `${n} aviso(s) vuelven a la cola de envío.` });
  }));
  route('POST', '/app/avisos/:id/rebote', guard(GESTION, (c) => {
    try { marcarRebotado(Number(c.params.id), c.body.get('motivo'), `${c.user.nombre} (${c.user.rol})`); } catch (e) { throw new E.ReglaError('M7', e.message); }
    c.back({ tipo: 'ok', msg: 'Aviso marcado como rebotado.' });
  }));
  route('POST', '/app/admin/correo/prueba', guard(['admin', 'jefatura'], (c) => {
    const para = (c.body.get('para') || '').trim();
    if (!direccionValida(para)) throw new E.ReglaError('M7', 'Indique un correo válido para la prueba');
    const r = send('T0', { destinatario: para, vars: { solicitante: c.user.nombre, fecha: fmtDateTime(new Date().toISOString()) } });
    c.redirect('/app/avisos?tipo=T0', { tipo: 'ok', msg: r.estado === 'pendiente' ? 'Correo de prueba en cola: se envía en unos segundos. Revise el estado aquí.' : `Correo de prueba registrado (${ESTADOS_AVISO[r.estado]}). El modo actual no envía correo real.` });
  }));

  // ---------- plantillas (M7) ----------
  route('GET', '/app/plantillas', guard(['jefatura'], (c) => {
    const vig = q.all('SELECT * FROM plantillas WHERE vigente=1 ORDER BY codigo');
    render(c, 'Plantillas', html`<h1>Plantillas de avisos</h1>
<p class="muted">Cada cambio crea una nueva versión (control de cambios 11.1). Variables disponibles: {{nombre}}, {{cargo}}, {{empleador}}, {{fecha_derivacion}}, {{fecha_cierre}}, {{codigo}}, {{enlace}}, {{contacto}}, {{mes_taller}}; bloque condicional {{#banco}}…{{/banco}} (solo si consintió el banco de futuras ofertas, RN-18).</p>
${vig.map((p) => html`<details class="card"><summary><strong>${p.codigo}</strong> · ${p.nombre} <span class="muted">v${p.version} · ${fmtDate(toDate(p.creado_at))}</span></summary>
  <form method="post" action="/app/plantillas/${p.codigo}" class="form">
    ${field('Asunto', raw(`<input name="asunto" value="${esc(p.asunto)}">`))}
    ${field('Cuerpo', raw(`<textarea name="cuerpo" rows="7">${esc(p.cuerpo)}</textarea>`))}
    <button class="btn btn-sm">Guardar como versión ${p.version + 1}</button>
  </form></details>`)}`);
  }));
  route('POST', '/app/plantillas/:codigo', guard(['jefatura'], (c) => {
    if (!plantillaVigente(c.params.codigo)) return c.redirect('/app/plantillas');
    const v = nuevaVersionPlantilla(c.params.codigo, c.body.get('asunto'), c.body.get('cuerpo'), `${c.user.nombre} (${c.user.rol})`);
    c.redirect('/app/plantillas', { tipo: 'ok', msg: `Plantilla ${c.params.codigo} actualizada a la versión ${v}.` });
  }));

  // ---------- reportes (M10) ----------
  route('GET', '/app/reportes', guard(['ejecutivo', 'jefatura', 'control', 'dideco'], (c) => {
    const t = c.url.searchParams.get('t') || trimestreActual();
    const r = informeTrimestral(t);
    const [y] = t.split('-T');
    const opciones = [];
    for (const yy of [Number(y) - 1, Number(y), Number(y) + 1]) for (const n of [1, 2, 3, 4]) opciones.push([`${yy}-T${n}`, `${yy} · ${n}° trimestre`]);
    render(c, 'Reportes', html`
<div class="row-between"><h1>Informe trimestral al Concejo</h1><a class="btn btn-ghost btn-sm" href="/app/reportes/${t}.csv">Exportar a planilla</a></div>
<form class="filters" method="get">${sel('t', opciones, t)}<button class="btn btn-ghost btn-sm">Ver</button></form>
<p class="note">Agregado y anonimizado (RN-17): no contiene datos personales y las celdas con menos de 5 personas se muestran como "menos de 5". Período ${fmtDate(r.desde)} a ${fmtDate(r.hasta)}.</p>
<div class="kpis">
  ${kpi('Cobertura del aviso de cierre', r.coberturaCierre, 'accent')}
  ${kpi('Avisos 3 en 5 días hábiles', r.pctA3EnPlazo)}
  ${kpi('Ofertas cerradas con resultado', r.pctConResultado)}
  ${kpi('Cerradas sin respuesta', r.pctSinRespuesta)}
</div>
<div class="grid2">
<section class="card"><h2>Ofertas por estado</h2>${table(['Estado', 'Ofertas'], r.porEstado)}<p>Vacantes ofrecidas: <strong>${r.vacantes}</strong></p></section>
<section class="card"><h2>Ofertas por área</h2>${table(['Área', 'Ofertas', 'Vacantes'], r.areas)}</section>
<section class="card"><h2>Postulaciones</h2>${table(['Indicador', 'Valor'], [['Postulaciones recibidas', r.postulaciones], ['Clasificadas', r.clasificadas], ['Porcentaje que cumple', r.pctCumple]])}
  <h3>Principales motivos de no cumplimiento</h3>${table(['Motivo', 'Postulaciones'], r.motivos, 'Sin datos')}</section>
<section class="card"><h2>Colocación</h2>${table(['Indicador', 'Valor'], [['Personas contratadas (registradas en Traza OMIL)', r.personasContratadas], ['Colocaciones ponderadas SENCE (BNE)', r.colocacionesPonderadas]])}
  <p class="muted">Se informan en filas separadas: la colocación ponderada SENCE no equivale a personas.</p>
  ${c.user.rol === 'jefatura' ? html`<form method="post" action="/app/reportes/sence" class="inline"><input type="hidden" name="t" value="${t}"><input name="valor" type="number" min="0" aria-label="Colocaciones ponderadas" placeholder="Colocaciones ponderadas"><button class="btn btn-ghost btn-sm">Registrar dato BNE</button></form>` : ''}</section>
<section class="card"><h2>Ofertas municipales</h2>${table(['Indicador', 'Valor'], [['Ofertas municipales cerradas', r.municipal.cerradas], ['Contrataciones', r.municipal.contrataciones], ['Actas cargadas', r.municipal.actas], ['Abstenciones registradas', r.municipal.abstenciones], ['Seleccionados "cumple"', r.municipal.selCumple], ['Seleccionados "no cumple"', r.municipal.selNoCumple]])}</section>
<section class="card"><h2>Indicadores de gestión (11.2) · acumulado</h2>${table(['Indicador', 'Valor', 'Meta'], indicadores())}</section>
</div>`);
  }));
  route('POST', '/app/reportes/sence', guard(['jefatura'], (c) => {
    q.run(`INSERT INTO ajustes(clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor`, `colocaciones_sence_${c.body.get('t')}`, String(Number(c.body.get('valor')) || 0));
    log({ usuario: `${c.user.nombre} (${c.user.rol})`, entidad: 'reporte', accion: `colocaciones ponderadas SENCE ${c.body.get('t')} = ${c.body.get('valor')}` });
    c.redirect(`/app/reportes?t=${c.body.get('t')}`, { tipo: 'ok', msg: 'Dato registrado.' });
  }));
  route('GET', '/app/reportes/:t', guard(['ejecutivo', 'jefatura', 'control', 'dideco'], (c) => {
    const t = c.params.t.replace(/\.csv$/, '');
    const r = informeTrimestral(t);
    const rows = [['Sección', 'Indicador', 'Valor'],
      ...r.porEstado.map(([k, v]) => ['Ofertas por estado', k, v]), ['Ofertas', 'Vacantes ofrecidas', r.vacantes],
      ...r.areas.map(([a, o, v]) => ['Ofertas por área', a, `${o} ofertas / ${v} vacantes`]),
      ['Postulaciones', 'Recibidas', r.postulaciones], ['Postulaciones', 'Porcentaje que cumple', r.pctCumple],
      ...r.motivos.map(([m, n]) => ['Motivos de no cumplimiento', m, n]),
      ['Colocación', 'Personas contratadas', r.personasContratadas], ['Colocación', 'Colocaciones ponderadas SENCE', r.colocacionesPonderadas],
      ['Cierre', 'Ofertas cerradas con resultado', r.pctConResultado], ['Cierre', 'Ofertas cerradas sin respuesta', r.pctSinRespuesta],
      ['Cierre', 'Avisos 3 dentro de 5 días hábiles', r.pctA3EnPlazo], ['Cierre', 'Cobertura del aviso de cierre', r.coberturaCierre],
      ...Object.entries(r.municipal).map(([k, v]) => ['Ofertas municipales', k, v])];
    c.send(200, csv(rows), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="informe-concejo-${t}.csv"` });
  }));

  // ---------- auditoría (M9) ----------
  route('GET', '/app/auditoria', guard(['ejecutivo', 'jefatura', 'control', 'admin'], (c) => {
    const u = c.user;
    const chain = verifyChain();
    const filtro = c.url.searchParams.get('f') || '';
    let where = '1=1'; const params = [];
    if (u.rol === 'ejecutivo') { where = 'b.oferta_id IN (SELECT id FROM ofertas WHERE ejecutivo_id=?)'; params.push(u.id); }
    if (u.rol === 'admin') where = `b.entidad IN ('sistema','motor','usuario','plantilla','feriado')`;
    if (filtro) { where += ' AND (b.accion LIKE ? OR b.usuario LIKE ?)'; params.push(`%${filtro}%`, `%${filtro}%`); }
    const rows = q.all(`SELECT b.*, o.codigo FROM bitacora b LEFT JOIN ofertas o ON o.id=b.oferta_id WHERE ${where} ORDER BY b.id DESC LIMIT 400`, ...params);
    const muestras = q.all('SELECT m.*, u.nombre FROM muestras m LEFT JOIN usuarios u ON u.id=m.creado_por ORDER BY m.id DESC');
    const sem = `${today().slice(0, 4)}-S${Number(today().slice(5, 7)) <= 6 ? 1 : 2}`;
    render(c, 'Auditoría', html`
<h1>Auditoría y control</h1>
<div class="flash ${chain.ok ? 'flash-ok' : 'flash-error'}">Integridad de la bitácora: ${chain.ok ? `cadena verificada, ${chain.total} eventos encadenados con SHA-256 sin alteraciones.` : `cadena rota en el evento ${chain.rotoEn}.`}</div>
${['control', 'jefatura'].includes(u.rol) ? html`<section class="card"><h2>Muestras semestrales (P5)</h2>
  ${u.rol === 'control' ? html`<form method="post" action="/app/muestras" class="inline">
    ${field('Semestre', raw(`<input name="semestre" value="${sem}" size="9">`))}
    ${field('Semilla (opcional)', raw('<input name="semilla" placeholder="se genera al azar">'))}
    <button class="btn btn-sm">Generar muestra</button></form>
    <p class="muted">Sobrerrepresenta ofertas municipales (peso 3) e incluye siempre los casos marcados (RN-13). La semilla queda registrada: la misma semilla reproduce la misma muestra.</p>` : ''}
  ${table(['Semestre', 'Semilla', 'Ofertas', 'Generada por', 'Fecha', ''], muestras.map((m) => [m.semestre, html`<code>${m.semilla}</code>`, JSON.parse(m.ofertas_json).length, m.nombre || '—', fmtDate(toDate(m.creado_at)), html`<a href="/app/muestras/${m.id}">Revisar</a>`]), 'Aún no hay muestras')}
</section>` : ''}
<section><div class="row-between"><h2>Bitácora ${u.rol === 'ejecutivo' ? '(de sus ofertas)' : u.rol === 'admin' ? '(técnica)' : ''}</h2>
<form method="get" class="inline"><input name="f" value="${filtro}" placeholder="Buscar acción o usuario" aria-label="Buscar en la bitácora"><button class="btn btn-ghost btn-sm">Buscar</button></form></div>
${bitacoraTable(rows, true)}</section>`);
  }));
  route('POST', '/app/muestras', guard(['control'], (c) => {
    const id = E.generarMuestra(c.body.get('semestre'), c.body.get('semilla'), c.user);
    c.redirect(`/app/muestras/${id}`, { tipo: 'ok', msg: 'Muestra generada y registrada en la bitácora.' });
  }));
  route('GET', '/app/muestras/:id', guard(['control', 'jefatura'], (c) => {
    const m = q.get('SELECT * FROM muestras WHERE id=?', Number(c.params.id));
    if (!m) return c.redirect('/app/auditoria');
    const ids = JSON.parse(m.ofertas_json);
    const ofertas = ids.map((id) => E.getOferta(id));
    const hall = q.all('SELECT h.*, o.codigo, u.nombre FROM hallazgos h JOIN ofertas o ON o.id=h.oferta_id LEFT JOIN usuarios u ON u.id=h.registrado_por WHERE muestra_id=? ORDER BY h.id', m.id);
    const rep = E.seleccionarMuestra(m.semestre, m.semilla).elegidas;
    const reproducible = JSON.stringify(rep) === JSON.stringify(ids);
    render(c, 'Muestra', html`
<p><a href="/app/auditoria">← Auditoría</a></p>
<h1>Muestra ${m.semestre}</h1>
<p>Semilla <code>${m.semilla}</code> · ${ids.length} expedientes · ${reproducible ? badge('Reproducible: la semilla genera la misma selección', 'ok') : badge('La población cambió desde la generación', 'warn')}</p>
${table(['Código', 'Cargo', 'Empleador', 'Estado', 'Marca', ''], ofertas.map((o) => [o.codigo, html`${o.cargo}${o.municipal ? html` ${badge('Municipal', 'accent')}` : ''}`, o.razon_social, badgeOferta(o.estado), o.marcada_control ? badge(o.motivo_marca, 'danger') : '—', html`<a href="/app/ofertas/${o.id}">Expediente (solo lectura)</a>`]))}
<h2>Hallazgos</h2>
${table(['Oferta', 'Gravedad', 'Hallazgo', 'Registrado', 'Plan de acción (jefatura)'], hall.map((h) => [h.codigo, badge(h.gravedad, h.gravedad === 'grave' ? 'danger' : h.gravedad === 'moderado' ? 'warn' : 'muted'), h.descripcion, `${h.nombre} · ${fmtDate(toDate(h.fecha))}`,
    h.plan_accion ? html`${h.plan_accion}<br><small>${fmtDate(toDate(h.respondido_at))}</small>` : c.user.rol === 'jefatura' ? html`<form method="post" action="/app/hallazgos/${h.id}/plan" class="inline"><input name="plan" placeholder="Plan de acción" aria-label="Plan de acción"><button class="btn btn-sm">Responder</button></form>` : badge('Pendiente', 'warn')]), 'Sin hallazgos registrados')}
${c.user.rol === 'control' ? html`<form method="post" action="/app/muestras/${m.id}/hallazgos" class="form card">
  <h3>Registrar hallazgo</h3>
  <div class="grid2">${field('Expediente', sel('oferta_id', ofertas.map((o) => [o.id, `${o.codigo} · ${o.cargo}`])))}${field('Gravedad', sel('gravedad', [['leve', 'Leve'], ['moderado', 'Moderado'], ['grave', 'Grave']]))}</div>
  ${field('Descripción', raw('<textarea name="descripcion" rows="3" required></textarea>'))}
  <button class="btn btn-sm">Registrar</button></form>` : ''}`);
  }));
  route('POST', '/app/muestras/:id/hallazgos', guard(['control'], (c) => {
    E.registrarHallazgo(Number(c.params.id), Number(c.body.get('oferta_id')), c.body.get('descripcion'), c.body.get('gravedad'), c.user);
    c.back({ tipo: 'ok', msg: 'Hallazgo registrado.' });
  }));
  route('POST', '/app/hallazgos/:id/plan', guard(['jefatura'], (c) => {
    E.responderHallazgo(Number(c.params.id), c.body.get('plan'), c.user);
    c.back({ tipo: 'ok', msg: 'Plan de acción registrado.' });
  }));

  // ---------- datos personales (M14, CU-15) ----------
  route('GET', '/app/datos', guard(['dpo', 'jefatura'], (c) => {
    const sol = q.all(`SELECT s.*, pe.nombre, pe.rut FROM solicitudes_titular s JOIN personas pe ON pe.id=s.persona_id ORDER BY s.estado='pendiente' DESC, s.plazo`);
    const cons = q.all(`SELECT tipo, estado, COUNT(*) n FROM consentimientos GROUP BY tipo, estado`);
    const anon = q.get('SELECT COUNT(*) c FROM personas WHERE anonimizada=1').c;
    const cong = q.all('SELECT * FROM ofertas WHERE congelada=1');
    render(c, 'Datos personales', html`<h1>Datos personales (Ley N°21.719)</h1>
<section class="card"><h2>Solicitudes de los titulares</h2>
${table(['Persona', 'Derecho', 'Detalle', 'Recibida', 'Plazo', 'Estado', ''], sol.map((s) => [html`${s.nombre}<br><small>${s.rut || ''}</small>`, s.tipo, s.detalle || '', fmtDate(toDate(s.fecha)),
    html`<span class="${s.estado === 'pendiente' && s.plazo < today() ? 'txt-danger' : ''}">${fmtDate(s.plazo)}</span>`, s.estado + (s.respuesta ? ` — ${s.respuesta}` : ''),
    s.estado === 'pendiente' && c.user.rol === 'dpo' ? html`<form method="post" action="/app/datos/solicitudes/${s.id}" class="stack">
      <input name="respuesta" placeholder="Respuesta" aria-label="Respuesta" required>
      ${s.tipo === 'supresion' ? html`<label class="check"><input type="checkbox" name="anonimizar" value="si"> Anonimizar datos</label>` : ''}
      <div><button name="estado" value="resuelta" class="btn btn-sm">Resolver</button> <button name="estado" value="rechazada" class="btn btn-ghost btn-sm">Rechazar</button></div></form>` : '']), 'Sin solicitudes')}
</section>
<div class="grid2">
<section class="card"><h2>Consentimientos</h2>${table(['Tipo', 'Estado', 'Cantidad'], cons.map((x) => [x.tipo, x.estado, sup(x.n)]))}</section>
<section class="card"><h2>Conservación (RN-19)</h2>
<p>Plazo propuesto: ${E.PARAM.mesesConservacion} meses desde el cierre, salvo consentimiento vigente para el banco de futuras ofertas o expediente congelado. El motor anonimiza automáticamente al vencer.</p>
<p>Personas anonimizadas: <strong>${anon}</strong></p>
<h3>Expedientes congelados por denuncia (P6)</h3>${table(['Oferta', 'Caso OIRS'], cong.map((o) => [html`<a href="/app/ofertas/${o.id}">${o.codigo}</a>`, o.caso_oirs]), 'Ninguno')}</section>
</div>`);
  }));
  route('POST', '/app/datos/solicitudes/:id', guard(['dpo'], (c) => {
    E.resolverSolicitud(Number(c.params.id), { estado: c.body.get('estado'), respuesta: c.body.get('respuesta'), anonimizar: c.body.get('anonimizar') === 'si' }, c.user);
    c.redirect('/app/datos', { tipo: 'ok', msg: 'Solicitud actualizada.' });
  }));

  // ---------- administración ----------
  route('GET', '/app/admin', guard(['admin', 'jefatura'], (c) => {
    const users = q.all('SELECT * FROM usuarios ORDER BY activo DESC, rol, nombre');
    const fer = q.all(`SELECT * FROM feriados WHERE fecha >= ? ORDER BY fecha LIMIT 40`, addDays(today(), -30));
    const admin = c.user.rol === 'admin';
    render(c, 'Administración', html`<h1>Administración</h1>
<section class="card"><h2>Usuarios y roles</h2>
${table(['Nombre', 'Correo', 'Rol', 'Estado', ''], users.map((u) => [u.nombre, u.correo, ROLES[u.rol], u.activo ? badge('Activo', 'ok') : badge('De baja', 'muted'),
    admin ? html`<form method="post" action="/app/admin/usuarios/${u.id}/estado"><button class="btn btn-ghost btn-sm">${u.activo ? 'Dar de baja' : 'Reactivar'}</button></form>` : '']))}
${admin ? html`<form method="post" action="/app/admin/usuarios" class="inline">
  <input name="nombre" placeholder="Nombre" aria-label="Nombre" required><input name="correo" type="email" placeholder="Correo institucional" aria-label="Correo" required>
  ${sel('rol', Object.entries(ROLES))}<button class="btn btn-sm">Crear usuario</button></form>` : html`<p class="muted">La jefatura propone cambios de usuarios; los ejecuta el Administrador (matriz 5.3).</p>`}
</section>
<div class="grid2">
<section class="card"><h2>Calendario de feriados (RN-15)</h2>
${table(['Fecha', 'Feriado', ''], fer.map((f) => [fmtDate(f.fecha), f.nombre, admin ? html`<form method="post" action="/app/admin/feriados/borrar"><input type="hidden" name="fecha" value="${f.fecha}"><button class="btn btn-ghost btn-sm" aria-label="Quitar ${f.nombre}">Quitar</button></form>` : '']))}
${admin ? html`<form method="post" action="/app/admin/feriados" class="inline"><input type="date" name="fecha" required aria-label="Fecha"><input name="nombre" placeholder="Nombre del feriado" aria-label="Nombre" required><button class="btn btn-sm">Agregar</button></form>` : ''}
</section>
${(() => { const rc = resumenCorreo(); const cola = Object.fromEntries(q.all('SELECT estado_entrega e, COUNT(*) n FROM avisos GROUP BY 1').map((r) => [r.e, r.n])); return html`<section class="card" id="correo"><h2>Correo de avisos (M7)</h2>
<dl class="dl"><dt>Modo</dt><dd>${rc.modo === 'simulado' ? badge('Simulado', 'muted') : badge(rc.modo.toUpperCase(), 'info')}</dd><dt>Entorno</dt><dd>${rc.entorno}</dd><dt>Envío</dt><dd>${rc.destino}</dd>
<dt>Remitente</dt><dd>${rc.remitente}</dd><dt>Responder a</dt><dd>${rc.responderA}</dd>${rc.redirigirA ? html`<dt>Redirección de prueba</dt><dd>${badge(rc.redirigirA, 'warn')}</dd>` : ''}
<dt>Cola</dt><dd>${cola.pendiente || 0} en cola · ${cola.entregado || 0} enviados · ${cola.rebotado || 0} rebotados · ${(cola.error || 0) + (cola.retenido || 0)} con error o retenidos</dd></dl>
${rc.problemas.map((p) => html`<div class="flash flash-error" style="margin-top:1rem">${p}</div>`)}
<form method="post" action="/app/admin/correo/prueba" class="inline" style="margin-top:1rem"><input name="para" type="email" placeholder="correo@municipalidadcasablanca.cl" aria-label="Correo para la prueba" required><button class="btn btn-sm">Enviar correo de prueba</button></form>
<p class="note">La configuración se hace con variables de entorno en el servidor (archivo .env, ver .env.ejemplo). Las claves nunca se muestran aquí.</p></section>`; })()}
<section class="card"><h2>Exportación de datos (7.6.9)</h2>
${c.user.rol === 'jefatura' ? html`<p>Exportación completa en formato abierto, incluida la bitácora. Contiene datos personales: queda registrada.</p>
<ul class="links"><li><a href="/app/export.json">Todo (JSON)</a></li>${['ofertas', 'requisitos', 'postulaciones', 'evaluaciones', 'personas', 'consentimientos', 'empleadores', 'avisos', 'bitacora', 'declaraciones', 'actas', 'resultados'].map((t) => html`<li><a href="/app/export/${t}.csv">${t}.csv</a></li>`)}</ul>
<p><a href="/app/export/bne.csv">Archivo de conciliación para BNE</a> (ofertas cerradas y personas contratadas)</p>`
    : html`<p class="muted">La exportación con datos personales la realiza la jefatura OMIL.</p>`}
<h3>API pública</h3><p><a href="/api/ofertas.json">/api/ofertas.json</a> — ofertas sin datos personales.</p>
</section></div>`);
  }));
  route('POST', '/app/admin/usuarios', guard(['admin'], (c) => {
    const r = q.run('INSERT INTO usuarios(nombre, correo, rol, creado_at) VALUES (?,?,?,?)', c.body.get('nombre'), c.body.get('correo'), c.body.get('rol'), new Date().toISOString());
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'usuario', entidad_id: Number(r.lastInsertRowid), accion: `alta de usuario con rol ${c.body.get('rol')}` });
    c.redirect('/app/admin', { tipo: 'ok', msg: 'Usuario creado.' });
  }));
  route('POST', '/app/admin/usuarios/:id/estado', guard(['admin'], (c) => {
    const u = q.get('SELECT * FROM usuarios WHERE id=?', Number(c.params.id));
    q.run('UPDATE usuarios SET activo=? WHERE id=?', u.activo ? 0 : 1, u.id);
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'usuario', entidad_id: u.id, accion: u.activo ? 'baja de usuario' : 'reactivación de usuario', despues: { nombre: u.nombre } });
    c.redirect('/app/admin', { tipo: 'ok', msg: `${u.nombre}: ${u.activo ? 'dado de baja' : 'reactivado'}.` });
  }));
  route('POST', '/app/admin/feriados', guard(['admin'], (c) => {
    q.run('INSERT OR REPLACE INTO feriados(fecha, nombre) VALUES (?,?)', c.body.get('fecha'), c.body.get('nombre'));
    invalidateFeriados();
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'feriado', accion: `feriado agregado ${c.body.get('fecha')}` });
    c.redirect('/app/admin', { tipo: 'ok', msg: 'Feriado agregado.' });
  }));
  route('POST', '/app/admin/feriados/borrar', guard(['admin'], (c) => {
    q.run('DELETE FROM feriados WHERE fecha=?', c.body.get('fecha'));
    invalidateFeriados();
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'feriado', accion: `feriado quitado ${c.body.get('fecha')}` });
    c.redirect('/app/admin', { tipo: 'ok', msg: 'Feriado quitado.' });
  }));
  const TABLAS = ['ofertas', 'requisitos', 'postulaciones', 'evaluaciones', 'personas', 'consentimientos', 'empleadores', 'avisos', 'bitacora', 'declaraciones', 'actas', 'resultados', 'derivaciones', 'muestras', 'hallazgos', 'solicitudes_titular', 'plantillas', 'feriados', 'usuarios', 'entrevistadores'];
  route('GET', '/app/export.json', guard(['jefatura'], (c) => {
    log({ usuario: `${c.user.nombre} (jefatura)`, entidad: 'sistema', accion: 'exportación completa JSON' });
    c.send(200, JSON.stringify(Object.fromEntries(TABLAS.map((t) => [t, q.all(`SELECT * FROM ${t}`)])), null, 1), 'application/json; charset=utf-8', { 'Content-Disposition': 'attachment; filename="traza-omil.json"' });
  }));
  route('GET', '/app/export/:tabla', guard(['jefatura'], (c) => {
    const t = c.params.tabla.replace(/\.csv$/, '');
    if (t === 'bne') {
      const rows = q.all(`SELECT o.codigo, o.cargo, e.rut empleador_rut, e.razon_social, o.estado, substr(o.cerrada_at,1,10) cierre, r.contratados_json FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id
        LEFT JOIN resultados r ON r.oferta_id=o.id AND r.vigente=1 WHERE o.cerrada_at IS NOT NULL`);
      const out = [['codigo_oferta', 'cargo', 'empleador_rut', 'empleador', 'estado', 'fecha_cierre', 'rut_contratado', 'registrada_bne']];
      for (const r of rows) {
        const cs = JSON.parse(r.contratados_json || '[]');
        if (!cs.length) out.push([r.codigo, r.cargo, r.empleador_rut, r.razon_social, r.estado, r.cierre, '', '']);
        for (const pid of cs) out.push([r.codigo, r.cargo, r.empleador_rut, r.razon_social, r.estado, r.cierre, q.get('SELECT pe.rut FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id WHERE p.id=?', pid)?.rut, q.get('SELECT registrada_bne FROM ofertas WHERE codigo=?', r.codigo).registrada_bne ? 'sí' : 'no']);
      }
      log({ usuario: `${c.user.nombre} (jefatura)`, entidad: 'sistema', accion: 'exportación para conciliación BNE' });
      return c.send(200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="conciliacion-bne.csv"' });
    }
    if (!TABLAS.includes(t)) return c.send(404, 'No existe', 'text/plain');
    const rows = q.all(`SELECT * FROM ${t}`);
    log({ usuario: `${c.user.nombre} (jefatura)`, entidad: 'sistema', accion: `exportación ${t}.csv` });
    c.send(200, csv([rows.length ? Object.keys(rows[0]) : [], ...rows.map((r) => Object.values(r))]), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${t}.csv"` });
  }));
}

function bitacoraTable(rows, conOferta = false) {
  return table(['Fecha', 'Usuario', ...(conOferta ? ['Oferta'] : []), 'Entidad', 'Acción', 'Detalle', 'Huella'], rows.map((b) => [
    fmtDateTime(b.fecha), b.usuario, ...(conOferta ? [b.codigo ? html`<a href="/app/ofertas/${b.oferta_id}">${b.codigo}</a>` : '—'] : []), b.entidad, b.accion,
    b.valor_nuevo || b.valor_anterior ? html`<details><summary>ver</summary><small>antes: ${b.valor_anterior || '—'}<br>después: ${b.valor_nuevo || '—'}</small></details>` : '',
    html`<code title="${b.huella}">${b.huella.slice(0, 10)}</code>`]), 'Sin eventos');
}

function panelOtros(u) {
  const ind = indicadores();
  const tot = q.get(`SELECT COUNT(*) o, SUM(estado='publicada') pub, SUM(estado='derivada') der FROM ofertas`);
  const sol = q.all(`SELECT * FROM solicitudes_titular WHERE estado='pendiente' ORDER BY plazo`);
  const marcadas = q.all(`SELECT * FROM ofertas WHERE marcada_control=1`);
  return html`<h1>Panel · ${ROLES[u.rol]}</h1>
<div class="kpis">${kpi('Ofertas registradas', tot.o)}${kpi('Publicadas', tot.pub || 0)}${kpi('Esperando resultado', tot.der || 0)}
${u.rol === 'dpo' ? kpi('Solicitudes de titulares pendientes', sol.length, sol.length ? 'warn' : '', '/app/datos') : ''}
${u.rol === 'control' ? kpi('Casos marcados para Control', marcadas.length, marcadas.length ? 'danger' : '', '/app/auditoria') : ''}</div>
<section class="card"><h2>Indicadores (11.2)</h2>${table(['Indicador', 'Valor', 'Meta'], ind)}</section>
${u.rol === 'control' ? html`<section class="card"><h2>Casos marcados (RN-13)</h2>${table(['Oferta', 'Motivo', ''], marcadas.map((o) => [o.codigo, o.motivo_marca, html`<a href="/app/ofertas/${o.id}">Ver</a>`]), 'Ninguno')}</section>` : ''}
<p>${u.rol === 'admin' ? html`<a href="/app/admin">Ir a Administración</a>` : u.rol === 'dpo' ? html`<a href="/app/datos">Ir a Datos personales</a>` : html`<a href="/app/reportes">Ver informe trimestral</a>`}</p>`;
}

// ---------- expediente de la oferta ----------
function expediente(c, id) {
  const u = c.user;
  const o = E.getOferta(id);
  const reqs = q.all('SELECT * FROM requisitos WHERE oferta_id=? ORDER BY tipo, id', id);
  const acc = E.accesoFuncionario(o, u);
  const gestor = GESTION.includes(u.rol) && (u.rol === 'jefatura' || o.ejecutivo_id === u.id);
  const der = E.derivacionDe(id);
  const res = E.resultadoVigente(id);
  const acta = q.get('SELECT * FROM actas WHERE oferta_id=?', id);
  const objetables = E.requisitosObjetables(id);
  const posts = acc.ok ? q.all(`SELECT p.*, pe.nombre, pe.rut FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id WHERE p.oferta_id=? ORDER BY p.id`, id) : [];
  const conteo = q.get(`SELECT COUNT(*) n, SUM(estado='recibida') sin, SUM(clasif_final='cumple') cumple FROM postulaciones WHERE oferta_id=?`, id);
  const avisos = q.all(`SELECT a.tipo, a.estado_entrega, COUNT(*) n, MAX(a.enviado_at) ult FROM avisos a WHERE a.oferta_id=? GROUP BY a.tipo, a.estado_entrega ORDER BY a.tipo`, id);
  const bit = u.rol === 'ejecutivo' && o.ejecutivo_id !== u.id ? [] : q.all('SELECT * FROM bitacora WHERE oferta_id=? ORDER BY id DESC LIMIT 200', id);
  const ejecutivos = q.all(`SELECT * FROM usuarios WHERE rol='ejecutivo' AND activo=1`);
  const diasDer = o.derivada_at ? calendarDaysBetween(toDate(o.derivada_at), today()) : null;
  const hitos = [
    ['Ingreso', fmtDate(toDate(o.creado_at)), true],
    ['Publicación', o.publicada_at ? fmtDate(toDate(o.publicada_at)) : '—', !!o.publicada_at],
    ['Cierre postulación', fmtDate(o.fecha_cierre_postulacion), o.fecha_cierre_postulacion && today() > o.fecha_cierre_postulacion],
    ['Derivación', o.derivada_at ? fmtDate(toDate(o.derivada_at)) : `prevista ${fmtDate(o.fecha_derivacion)}`, !!o.derivada_at],
    ['Recordatorio día 10', o.derivada_at ? fmtDate(addDays(toDate(o.derivada_at), 10)) : '—', !!o.recordatorio10],
    ['Recordatorio día 20', o.derivada_at ? fmtDate(addDays(toDate(o.derivada_at), 20)) : '—', !!o.recordatorio20],
    ['Cierre automático día 30', o.derivada_at ? fmtDate(addDays(toDate(o.derivada_at), 30)) : '—', o.estado === 'cerrada_sin_respuesta'],
    ['Cierre', o.cerrada_at ? fmtDate(toDate(o.cerrada_at)) : '—', !!o.cerrada_at],
  ];
  const decEnt = o.municipal ? E.estadoDeclaracionesEntrevistadores(id) : null;
  const decStaff = o.municipal ? q.all(`SELECT * FROM declaraciones WHERE oferta_id=? AND declarante_tipo='usuario'`, id) : [];
  const miDecl = o.municipal ? E.declaracionDe(id, 'usuario', u.id) : null;
  const nombresPost = o.municipal ? q.all(`SELECT p.id, pe.nombre FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id WHERE p.oferta_id=?`, id) : [];

  return html`
<p><a href="/app/ofertas">← Ofertas</a></p>
<div class="row-between">
  <div><h1>${o.cargo}</h1><p class="muted">${o.codigo} · ${o.razon_social} · v${o.version} · ejecutivo/a: ${o.ejecutivo_nombre || 'sin asignar'}</p></div>
  <div class="badges">${badgeOferta(o.estado)} ${o.municipal ? badge('Oferta municipal · P4', 'accent') : ''} ${o.congelada ? badge(`Congelada · OIRS ${o.caso_oirs}`, 'danger') : ''} ${o.marcada_control ? badge(o.motivo_marca, 'danger') : ''}</div>
</div>
${o.requiere_autorizacion && !o.autorizada_por && ['en_validacion', 'observada'].includes(o.estado) ? html`<div class="flash flash-error"><strong>RN-09</strong> · El empleador tiene una oferta cerrada sin respuesta en los últimos 12 meses. La publicación requiere autorización de la jefatura OMIL.
  ${u.rol === 'jefatura' ? html`<form method="post" action="/app/ofertas/${id}/autorizar" class="inline"><button class="btn btn-sm">Autorizar publicación</button></form>` : ''}</div>` : ''}
${objetables.length && ['en_validacion', 'observada'].includes(o.estado) ? html`<div class="flash flash-error"><strong>P1.3</strong> · Requisitos posiblemente discriminatorios (art. 2 Código del Trabajo): ${objetables.map((r) => `"${r.descripcion}"`).join(', ')}. Observe la oferta para que el empleador los corrija.</div>` : ''}
${o.observacion ? html`<div class="flash flash-info"><strong>Observación enviada al empleador:</strong> ${o.observacion}</div>` : ''}

<ol class="hitos">${hitos.map(([l, f, done]) => html`<li class="${done ? 'done' : ''}"><span>${l}</span><strong>${f}</strong></li>`)}</ol>
${o.estado === 'derivada' && !res ? html`<p class="${diasDer >= 20 ? 'txt-danger' : diasDer >= 10 ? 'txt-warn' : ''}">Día <strong>${diasDer}</strong> de 30 desde la derivación sin resultado del empleador.</p>` : ''}

${gestor ? accionesOferta(c, o, res, ejecutivos) : ''}

<div class="grid2">
<section class="card"><h2>Descriptor del cargo</h2>
  <dl class="dl"><dt>Área</dt><dd>${o.area || '—'}</dd><dt>Vacantes</dt><dd>${o.vacantes}</dd><dt>Jornada</dt><dd>${o.jornada || '—'}</dd><dt>Renta</dt><dd>${o.renta || '—'}</dd>
  <dt>Empleador</dt><dd>${o.razon_social} ${o.estado_cumplimiento !== 'al_dia' ? badge('sin resultado informado', 'danger') : ''}<br><small>${o.contacto_nombre || ''} · ${o.contacto_correo}</small></dd></dl>
  ${o.funciones ? html`<p>${o.funciones}</p>` : ''}</section>
<section class="card"><h2>Requisitos</h2><ul class="reqs">${reqs.map((r) => html`<li class="${r.tipo}">${r.tipo === 'excluyente' ? badge('Excluyente', 'accent') : badge('Deseable', 'muted')} ${r.descripcion} <small class="muted">${r.categoria}</small></li>`)}</ul></section>
</div>

${o.municipal ? html`<section class="card" id="probidad"><h2>Probidad · declaraciones de vínculos (P4)</h2>
  <div class="grid2"><div>
  <h3>Funcionarios OMIL</h3>
  ${table(['Funcionario/a', 'Declaración'], decStaff.map((d) => [d.nombre, d.declara_vinculo ? badge('Declaró vínculo · abstención', 'danger') : badge(`Sin vínculo · ${fmtDate(toDate(d.fecha))}`, 'ok')]), 'Aún no hay declaraciones')}
  ${GESTION.includes(u.rol) && !miDecl ? html`<form method="post" action="/app/ofertas/${id}/declarar" class="form">
    <p><strong>Su declaración (RN-10):</strong> antes de ver la nómina, revise la lista y declare si tiene parentesco o relación con algún postulante.</p>
    <details><summary>Ver lista de postulantes (${nombresPost.length})</summary><ul class="cols">${nombresPost.map((p) => html`<li>${p.nombre}</li>`)}</ul></details>
    <label class="check"><input type="radio" name="vinculo" value="no" checked> No tengo vínculo</label>
    <label class="check"><input type="radio" name="vinculo" value="si"> Declaro vínculo con ${sel('postulacion_id', [['', '—'], ...nombresPost.map((p) => [p.id, p.nombre])])}</label>
    ${field('Tipo de vínculo', raw('<input name="detalle">'))}${field('Firma', raw(`<input name="firma" value="${esc(u.nombre)}" required>`))}
    <button class="btn btn-sm">Firmar declaración</button></form>` : ''}
  </div><div>
  <h3>Entrevistadores de la Dirección</h3>
  ${table(['Entrevistador/a', 'Declaración', ''], q.all('SELECT * FROM entrevistadores WHERE oferta_id=? ORDER BY id', id).map((e) => ({ ...e, decl: E.declaracionDe(id, 'entrevistador', e.id) })).map((e) => [
    html`${e.nombre}${e.reemplaza_a ? html` <small>(reemplazo)</small>` : ''}${!e.activo ? html` <small>(inhabilitado y reemplazado)</small>` : ''}`,
    e.decl ? (e.decl.declara_vinculo ? badge('Declaró vínculo · abstención', 'danger') : badge(`Sin vínculo · ${fmtDate(toDate(e.decl.fecha))}`, 'ok')) : badge('Pendiente', 'warn'),
    e.decl?.declara_vinculo && e.activo && u.rol === 'jefatura' ? html`<form method="post" action="/app/ofertas/${id}/reemplazar" class="stack"><input type="hidden" name="entrevistador_id" value="${e.id}"><input type="hidden" name="ancla" value="#probidad">
      <input name="nombre" placeholder="Nombre del reemplazo" aria-label="Nombre del reemplazo" required><input name="correo" type="email" placeholder="Correo" aria-label="Correo del reemplazo"><button class="btn btn-sm">Designar reemplazo</button></form>` : '']))}
  <p class="muted">${decEnt.completo ? 'Todas las declaraciones están firmadas sin vínculos: la Dirección puede ver la nómina.' : 'La Dirección no verá la nómina hasta que todos los entrevistadores activos declaren sin vínculo.'}</p>
  </div></div>
  ${acta ? html`<h3>Acta de selección</h3><dl class="dl"><dt>Entrevistados</dt><dd>${JSON.parse(acta.entrevistados_json).length} personas</dd><dt>Criterio</dt><dd>${acta.criterio}</dd><dt>Firmantes</dt><dd>${acta.firmantes}</dd><dt>Documento</dt><dd>${acta.documento || '—'}</dd>${acta.justificacion_no_cumple ? html`<dt>Justificación RN-13</dt><dd>${acta.justificacion_no_cumple}</dd>` : ''}</dl>` : ''}
</section>` : ''}

<section class="card" id="postulaciones"><div class="row-between"><h2>Postulaciones <span class="count">${conteo.n}</span></h2>
  <span class="muted">${conteo.sin || 0} sin clasificar · ${conteo.cumple || 0} cumplen</span></div>
${acc.ok ? html`
${table(['Postulante', 'RUT', 'Canal', 'Fecha', 'Clasificación', 'Estado', ''], posts.map((p) => [p.nombre, p.rut || '—', p.canal, fmtDate(toDate(p.creado_at)),
    html`${badgeClasif(p.clasif_final)}${p.justificacion_cambio ? html` <small title="${p.justificacion_cambio}">corregida</small>` : ''}`, badgePost(p.estado),
    html`<a href="/app/postulaciones/${p.id}">${p.estado === 'recibida' && !acc.soloLectura ? 'Clasificar' : 'Ver'}</a>`]), 'Sin postulaciones')}
${o.estado === 'publicada' && gestor ? html`<details class="card inner"><summary>Registrar postulación presencial o por correo (CU-05)</summary>
<form method="post" action="/app/ofertas/${id}/postulacion" class="form"><input type="hidden" name="ancla" value="#postulaciones">
  <div class="grid2">${field('RUT', raw('<input name="rut" required>'))}${field('Nombre', raw('<input name="nombre" required>'))}${field('Correo', raw('<input name="correo" type="email">'))}${field('Teléfono', raw('<input name="telefono">'))}${field('Comuna', raw('<input name="comuna" value="Casablanca">'))}${field('Canal', sel('canal', [['presencial', 'Presencial (Chacabuco N°440)'], ['correo', 'Correo']]))}</div>
  <label class="check"><input type="checkbox" name="consentimiento_postular" value="si" required> La persona firmó el consentimiento informado para postular</label>
  <label class="check"><input type="checkbox" name="consentimiento_banco" value="si"> La persona consintió además el banco de futuras ofertas</label>
  <button class="btn btn-sm">Registrar</button></form></details>` : ''}`
    : html`<div class="flash flash-info">${acc.motivo}</div>`}
</section>

${der ? html`<section class="card"><h2>Derivación</h2><dl class="dl"><dt>Fecha</dt><dd>${fmtDateTime(der.fecha)}</dd><dt>Postulantes en la nómina</dt><dd>${der.n_postulantes}</dd>
  <dt>Huella de la nómina</dt><dd><code>${der.huella}</code></dd><dt>Enlace único del empleador</dt><dd>${gestor || u.rol === 'control' ? html`<a href="/e/${der.token}" target="_blank">/e/${der.token.slice(0, 10)}…</a>` : '—'}</dd><dt>Vence</dt><dd>${fmtDate(der.vence)}</dd></dl></section>` : ''}
${res ? html`<section class="card"><h2>Resultado</h2><dl class="dl"><dt>Informado</dt><dd>${fmtDateTime(res.fecha_informe)} · ${res.origen === 'empleador' ? 'por el empleador' : 'cierre automático'}</dd><dt>Tipo</dt><dd>${res.tipo}</dd>
  <dt>Personas contratadas</dt><dd>${JSON.parse(res.contratados_json).length}</dd>${res.comentario ? html`<dt>Comentario</dt><dd>${res.comentario}</dd>` : ''}<dt>Validado</dt><dd>${res.validado_at ? fmtDateTime(res.validado_at) : badge('Pendiente de validación', 'danger')}</dd></dl></section>` : ''}

<section class="card"><h2>Avisos de esta oferta</h2>${table(['Aviso', 'Entrega', 'Cantidad', 'Último'], avisos.map((a) => [a.tipo, badgeAviso(a.estado_entrega), a.n, fmtDateTime(a.ult)]), 'Sin avisos')}</section>
${bit.length ? html`<section class="card"><h2>Bitácora del expediente</h2>${bitacoraTable(bit)}</section>` : ''}`;
}

function accionesOferta(c, o, res, ejecutivos) {
  const u = c.user;
  const id = o.id;
  const items = [];
  if (o.estado === 'en_validacion') {
    items.push(html`<form method="post" action="/app/ofertas/${id}/publicar" class="action">
      <h3>Validar y publicar (CU-03)</h3>
      ${field('Cierre de postulación', raw(`<input type="date" name="fecha_cierre" value="">`), `Por defecto, ${E.PARAM.diasHabilesPostulacion} días hábiles desde hoy.`)}
      <button class="btn">Publicar</button></form>`);
    items.push(html`<form method="post" action="/app/ofertas/${id}/observar" class="action">
      <h3>Observar</h3>${field('Observación para el empleador', raw('<textarea name="observacion" rows="3" required></textarea>'))}<button class="btn btn-ghost">Devolver con observaciones</button></form>`);
  }
  if (o.estado === 'observada') {
    const reqs = q.all('SELECT * FROM requisitos WHERE oferta_id=?', id);
    items.push(html`<details class="action wide"><summary><strong>Registrar versión corregida</strong> (respuesta del empleador)</summary>
      <form method="post" action="/app/ofertas/${id}/version" class="form">${formOferta({ o, reqs })}<button class="btn">Guardar nueva versión</button></form></details>`);
  }
  if (['en_validacion', 'observada', 'publicada'].includes(o.estado)) {
    items.push(html`<form method="post" action="/app/ofertas/${id}/anular" class="action"><h3>Retiro / anulación</h3>${field('Motivo', raw('<input name="motivo" required>'))}<button class="btn btn-ghost" onclick="return confirm('¿Anular la oferta? Se avisará a los postulantes.')">Anular oferta</button></form>`);
  }
  if (o.estado === 'derivada' && res && !res.validado_at) {
    items.push(html`<form method="post" action="/app/ofertas/${id}/validar" class="action highlight"><h3>Resultado informado por el empleador</h3>
      <p>${res.tipo === 'contratacion' ? `${JSON.parse(res.contratados_json).length} persona(s) contratada(s).` : `Proceso ${res.tipo}.`} Al validar se cierra la oferta y se envía el ${res.tipo === 'contratacion' ? 'Aviso 3' : 'aviso equivalente al Aviso 3'} a los no seleccionados (RN-06: dentro de 5 días hábiles).</p>
      <button class="btn">Validar y cerrar</button></form>`);
  }
  if (['cerrada_con_resultado', 'cerrada_sin_respuesta'].includes(o.estado) && u.rol === 'jefatura') {
    items.push(html`<form method="post" action="/app/ofertas/${id}/reabrir" class="action"><h3>Reapertura excepcional (RN-14)</h3>${field('Justificación', raw('<textarea name="justificacion" rows="2" required></textarea>'))}<button class="btn btn-ghost">Reabrir</button></form>`);
  }
  if (E.CERRADAS.includes(o.estado) && !o.registrada_bne) {
    items.push(html`<form method="post" action="/app/ofertas/${id}/bne" class="action"><h3>Registro final</h3><p>Registre las contrataciones en la Bolsa Nacional de Empleo.</p><button class="btn btn-ghost">Marcar registrada en BNE</button></form>`);
  }
  if (u.rol === 'jefatura' && !E.CERRADAS.includes(o.estado)) {
    items.push(html`<form method="post" action="/app/ofertas/${id}/reasignar" class="action"><h3>Asignar ejecutivo/a</h3>${sel('ejecutivo_id', ejecutivos.map((e) => [e.id, e.nombre]), o.ejecutivo_id)}<button class="btn btn-ghost">Reasignar</button></form>`);
  }
  items.push(o.congelada
    ? (u.rol === 'jefatura' ? html`<form method="post" action="/app/ofertas/${id}/liberar" class="action"><h3>Denuncia OIRS ${o.caso_oirs}</h3><button class="btn btn-ghost">Terminar congelamiento</button></form>` : '')
    : html`<form method="post" action="/app/ofertas/${id}/oirs" class="action"><h3>Vincular denuncia OIRS (P6)</h3>${field('N° de caso', raw('<input name="caso" required>'))}<button class="btn btn-ghost">Vincular y congelar</button></form>`);
  return html`<section class="actions">${items}</section>`;
}
