// Rutas que solo existen en el servidor instalado (usan disco o reciben llamadas externas):
// respaldos (7.6.10) y webhook de entrega/rebote del servicio de correo (7.6.5).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { q, getDb } from './db.js';
import { log } from './audit.js';
import { guard, render } from './routes-staff.js';
import { html, table, badge, fmtDateTime } from './views.js';
import { respaldar, listarRespaldos, verificarRespaldo, dirRespaldos, retencion } from './respaldo.js';

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Verifica la firma Svix que usa Resend en sus webhooks. Devuelve null si es válida o el motivo del rechazo. */
export function verificarFirmaSvix(secreto, headers, raw, ahoraSeg = Date.now() / 1000) {
  const id = headers['svix-id'], ts = headers['svix-timestamp'], firmas = String(headers['svix-signature'] || '');
  if (!secreto || !id || !ts) return 'no autorizado';
  if (Math.abs(ahoraSeg - Number(ts)) > 300) return 'marca de tiempo fuera de rango';
  const k = Buffer.from(secreto.replace(/^whsec_/, ''), 'base64');
  const esperado = createHmac('sha256', k).update(`${id}.${ts}.${raw}`).digest('base64');
  const ok = firmas.split(' ').some((f) => { const v = f.split(',')[1] || ''; return v.length === esperado.length && timingSafeEqual(Buffer.from(v), Buffer.from(esperado)); });
  return ok ? null : 'firma inválida';
}

export function servidorRoutes(route) {
  route('GET', '/app/admin/respaldos', guard(['admin', 'jefatura'], (c) => {
    const lista = listarRespaldos();
    const cifra = !!process.env.TRAZA_RESPALDO_CLAVE;
    render(c, 'Respaldos', html`<p><a href="/app/admin">← Administración</a></p>
<h1>Respaldos de la base de datos</h1>
<div class="kpis">
  <div class="kpi accent"><span class="l">Respaldos guardados</span><span class="v">${lista.length}</span></div>
  <div class="kpi"><span class="l">Último</span><span class="v" style="font-size:16px">${lista[0] ? fmtDateTime(lista[0].fecha) : '—'}</span></div>
  <div class="kpi ${cifra ? '' : 'danger'}"><span class="l">Cifrado AES-256-GCM</span><span class="v" style="font-size:16px">${cifra ? 'Activo' : 'Sin clave'}</span></div>
</div>
${cifra ? '' : html`<div class="flash flash-error">Los respaldos se guardan <strong>sin cifrar</strong> porque falta TRAZA_RESPALDO_CLAVE en el .env. Contienen datos personales: configure la clave antes de producción y guárdela fuera del servidor.</div>`}
<p class="muted">Copia automática diaria desde las ${String(process.env.TRAZA_RESPALDO_HORA ?? 2).padStart(2, '0')}:00, se conservan los últimos ${retencion()}. Carpeta: <code>${dirRespaldos()}</code>. Para cumplir la regla de 3-2-1, Informática debe copiar esta carpeta a otro equipo o a la nube institucional.</p>
${c.user.rol === 'admin' ? html`<div class="inline" style="margin:1rem 0">
  <form method="post" action="/app/admin/respaldos/ahora"><button class="btn btn-sm">Respaldar ahora</button></form>
  ${lista[0] ? html`<form method="post" action="/app/admin/respaldos/verificar"><input type="hidden" name="archivo" value="${lista[0].archivo}"><button class="btn btn-ghost btn-sm">Probar restauración del último</button></form>` : ''}
</div>` : ''}
${table(['Archivo', 'Fecha', 'Tamaño', 'Cifrado', ''], lista.map((r) => [html`<code>${r.archivo}</code>`, fmtDateTime(r.fecha), kb(r.bytes), r.cifrado ? badge('Sí', 'ok') : badge('No', 'warn'),
    c.user.rol === 'admin' ? html`<form method="post" action="/app/admin/respaldos/verificar"><input type="hidden" name="archivo" value="${r.archivo}"><button class="btn btn-ghost btn-sm">Verificar</button></form>` : '']), 'Aún no hay respaldos')}
<section class="card" style="margin-top:1rem"><h2>Restaurar</h2>
<p>La restauración se hace con el servidor detenido, desde la consola del servidor:</p>
<pre class="mail">npm run respaldo -- restaurar ${lista[0]?.archivo || 'traza-AAAA-MM-DD….db.enc'}</pre>
<p class="muted">El comando verifica la integridad antes de restaurar y guarda una copia de la base actual junto a ella.</p></section>`);
  }));
  route('POST', '/app/admin/respaldos/ahora', guard(['admin'], (c) => {
    const r = respaldar(getDb(), { motivo: 'manual' });
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'sistema', accion: `respaldo manual ${r.archivo}`, despues: { cifrado: r.cifrado, bytes: r.bytes } });
    c.redirect('/app/admin/respaldos', { tipo: 'ok', msg: `Respaldo creado: ${r.archivo} (${kb(r.bytes)}${r.cifrado ? ', cifrado' : ', sin cifrar'}).` });
  }));
  route('POST', '/app/admin/respaldos/verificar', guard(['admin'], (c) => {
    const archivo = String(c.body.get('archivo') || '').replace(/[^\w.-]/g, '');
    let r;
    try { r = verificarRespaldo(archivo); } catch (e) { return c.redirect('/app/admin/respaldos', { tipo: 'error', msg: `No se pudo restaurar ${archivo}: ${e.message}` }); }
    log({ usuario: `${c.user.nombre} (admin)`, entidad: 'sistema', accion: `prueba de restauración ${archivo}: ${r.ok ? 'correcta' : 'FALLIDA'}`, despues: r });
    c.redirect('/app/admin/respaldos', { tipo: r.ok ? 'ok' : 'error', msg: r.ok
      ? `Restauración probada: ${archivo} se descifró y abrió íntegro (${r.ofertas} ofertas, ${r.postulaciones} postulaciones, ${r.avisos} avisos, ${r.bitacora} eventos de bitácora).`
      : `La verificación de integridad de ${archivo} falló.` });
  }));

  // Webhook de Resend (firmado con Svix): entrega confirmada, rebote y marca de spam actualizan el aviso.
  route('POST', '/webhooks/correo', (c) => {
    const motivo = verificarFirmaSvix(process.env.RESEND_WEBHOOK_SECRET || '', c.req.headers, c.raw);
    if (motivo) return c.send(401, motivo, 'text/plain');
    let ev;
    try { ev = JSON.parse(c.raw); } catch { return c.send(400, 'json inválido', 'text/plain'); }
    const aviso = q.get('SELECT * FROM avisos WHERE id_proveedor=?', ev?.data?.email_id || '');
    if (aviso) {
      if (ev.type === 'email.bounced' || ev.type === 'email.complained') {
        const motivo = ev.type === 'email.complained' ? 'El destinatario lo marcó como spam' : `Rebote: ${ev.data?.bounce?.message || ev.data?.bounce?.type || 'sin detalle'}`;
        q.run(`UPDATE avisos SET estado_entrega='rebotado', ultimo_error=? WHERE id=?`, motivo, aviso.id);
        log({ usuario: 'servicio de correo', entidad: 'aviso', entidad_id: aviso.id, oferta_id: aviso.oferta_id, accion: `aviso ${aviso.tipo} rebotado (informado por el proveedor)`, despues: { motivo } });
      } else if (ev.type === 'email.delivered') {
        q.run('UPDATE avisos SET entregado_at=? WHERE id=?', ev.created_at || new Date().toISOString(), aviso.id);
      }
    }
    c.send(200, 'ok', 'text/plain');
  });
}
