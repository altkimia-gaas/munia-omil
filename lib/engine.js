// Núcleo de gestión (M3–M6, M8): ciclo de vida de ofertas y postulaciones, reglas RN-01 a RN-19,
// temporizadores y controles de probidad. Ningún canal escribe directo: todo pasa por aquí,
// y cada cambio dispara bitácora y avisos.
import { createHash, randomBytes } from 'node:crypto';
import { q, tx } from './db.js';
import { log } from './audit.js';
import { send } from './notify.js';
import {
  today, nowIso, addDays, addBusinessDays, nextBusinessDay, businessDaysBetween,
  calendarDaysBetween, toDate, fmtDate, isBusinessDay,
} from './clock.js';

export class ReglaError extends Error {
  constructor(regla, msg) { super(msg); this.regla = regla; }
}
const fail = (regla, msg) => { throw new ReglaError(regla, msg); };

export const PARAM = {
  diasHabilesPostulacion: 10,      // P1.5
  recordatorios: [10, 20],         // RN-08
  diasCierreAuto: 30,              // RN-07
  diasHabilesAviso3: 5,            // RN-06
  mesesRN09: 12,                   // RN-09
  mesesConservacion: 24,           // RN-19
  diasPlazoTitular: 30,            // plazo legal de respuesta (parametrizable)
  umbralSupresion: 5,              // RN-17
  versionConsentimiento: 'v1.0-2026-12',
};

export const ESTADO_OFERTA = {
  en_validacion: 'En validación', observada: 'Observada', publicada: 'Publicada', derivada: 'Derivada',
  cerrada_con_resultado: 'Cerrada con resultado', cerrada_sin_respuesta: 'Cerrada sin respuesta',
  desierta_anulada: 'Desierta o anulada',
};
export const ESTADO_POST = {
  recibida: 'Recibida', clasificada: 'Clasificada', derivada: 'Derivada', seleccionada: 'Seleccionada',
  no_seleccionada: 'No seleccionada', cerrada_sin_resultado: 'Cerrada sin resultado', retirada: 'Retirada',
};
// Lo que ve el postulante (7.2). La clasificación no se muestra para no desalentar.
export const ESTADO_POST_PUBLICO = {
  recibida: 'Recibimos su postulación', clasificada: 'En revisión',
  derivada: 'Sus antecedentes fueron enviados al empleador', seleccionada: 'El empleador lo contactará',
  no_seleccionada: 'El proceso finalizó', cerrada_sin_resultado: 'El proceso se cerró sin respuesta del empleador',
  retirada: 'Usted retiró su postulación',
};
export const CERRADAS = ['cerrada_con_resultado', 'cerrada_sin_respuesta', 'desierta_anulada'];
export const MOTIVOS_NO_CUMPLE = {
  formacion_insuficiente: 'Formación no acredita el nivel exigido',
  experiencia_insuficiente: 'Experiencia menor a la exigida',
  sin_licencia: 'No tiene la licencia exigida',
  sin_certificacion: 'No tiene la certificación exigida',
  documento_faltante: 'No presentó el documento que acredita',
  otro: 'Otro motivo',
};

// ---------- utilidades ----------
export function normRut(rut) {
  const s = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return null;
  return `${Number(s.slice(0, -1))}-${s.slice(-1)}`;
}
export function rutValido(rut) {
  const n = normRut(rut);
  if (!n) return false;
  const [cuerpo, dv] = n.split('-');
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11);
  const esperado = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return dv === esperado;
}
const token = (n = 24) => randomBytes(n).toString('base64url');
const codigoSeguimiento = () => randomBytes(4).toString('hex').toUpperCase();
const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const actorName = (a) => (a ? (typeof a === 'string' ? a : `${a.nombre} (${a.rol})`) : 'sistema');

// Revisión de requisitos discriminatorios (P1.3, art. 2 Código del Trabajo)
const PATRONES_DISCRIMINATORIOS = [
  /\bsexo\b/i, /\bhombre[s]?\b/i, /\bmujer(es)?\b/i, /\bvar[oó]n\b/i, /\bedad\b/i, /\bmenor(es)? de \d+/i,
  /\bmayor(es)? de \d+ a[nñ]os/i, /\bentre \d+ y \d+ a[nñ]os/i, /estado civil/i, /\bsoltero|casad[oa]\b/i,
  /buena presencia/i, /\bnacionalidad\b/i, /\breligi[oó]n\b/i, /\bembaraz/i, /\bsindica/i, /orientaci[oó]n sexual/i,
];
export function requisitosObjetables(oferta_id) {
  return q.all('SELECT * FROM requisitos WHERE oferta_id=?', oferta_id)
    .filter((r) => PATRONES_DISCRIMINATORIOS.some((p) => p.test(r.descripcion)));
}

export function getOferta(id) {
  const o = q.get(`SELECT o.*, e.razon_social, e.rut AS empleador_rut, e.tipo AS empleador_tipo, e.contacto_nombre,
      e.contacto_correo, e.estado_cumplimiento, u.nombre AS ejecutivo_nombre
    FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id LEFT JOIN usuarios u ON u.id=o.ejecutivo_id WHERE o.id=?`, id);
  if (!o) fail('—', 'Oferta no encontrada');
  return o;
}
export const resultadoVigente = (oferta_id) =>
  q.get('SELECT * FROM resultados WHERE oferta_id=? AND vigente=1 ORDER BY id DESC LIMIT 1', oferta_id);

function setEstadoOferta(o, nuevo, actor, extra = {}) {
  const cols = Object.keys(extra);
  q.run(`UPDATE ofertas SET estado=?${cols.map((c) => `, ${c}=?`).join('')} WHERE id=?`, nuevo, ...cols.map((c) => extra[c]), o.id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: o.id, oferta_id: o.id, accion: `estado → ${nuevo}`, antes: { estado: o.estado }, despues: { estado: nuevo, ...extra } });
}
function setEstadoPost(p, nuevo, actor, oferta_id) {
  q.run('UPDATE postulaciones SET estado=? WHERE id=?', nuevo, p.id);
  log({ usuario: actorName(actor), entidad: 'postulacion', entidad_id: p.id, oferta_id, accion: `estado → ${nuevo}`, antes: { estado: p.estado }, despues: { estado: nuevo } });
}
function varsOferta(o) {
  return {
    cargo: o.cargo, empleador: o.razon_social, codigo_oferta: o.codigo, contacto_empleador: o.contacto_nombre || o.razon_social,
    fecha_cierre: fmtDate(o.fecha_cierre_postulacion), fecha_derivacion: fmtDate(o.fecha_derivacion || (o.derivada_at && toDate(o.derivada_at))),
    mes_taller: new Date(addDays(today(), 15) + 'T12:00').toLocaleDateString('es-CL', { month: 'long' }),
  };
}
const bancoVigente = (persona_id) =>
  !!q.get(`SELECT 1 FROM consentimientos WHERE persona_id=? AND tipo='banco_futuras' AND estado='vigente'`, persona_id);

// ---------- empleadores y ofertas (P1) ----------
export function registrarEmpleador(d, actor = 'empleador') {
  // Las Direcciones municipales comparten el RUT del municipio: se identifican por su sigla.
  const municipal = d.tipo === 'municipal';
  const rut = municipal ? `MUNI-${String(d.sigla || '').toUpperCase().replace(/[^A-Z]/g, '')}` : normRut(d.rut);
  if (municipal && rut === 'MUNI-') fail('CU-01', 'Indique la Dirección municipal');
  if (!municipal && (!rut || !rutValido(rut))) fail('CU-01', 'RUT del empleador no válido');
  if (!d.acepta_condicion) fail('CU-01', 'Debe aceptar la condición de servicio: informar el resultado del proceso');
  if (!d.contacto_correo) fail('CU-01', 'Falta el correo de contacto');
  const ex = q.get('SELECT * FROM empleadores WHERE rut=?', rut);
  if (ex) {
    q.run(`UPDATE empleadores SET razon_social=?, contacto_nombre=?, contacto_correo=?, telefono=?, acepta_condicion=1, acepta_at=COALESCE(acepta_at, ?) WHERE id=?`,
      d.razon_social || ex.razon_social, d.contacto_nombre || ex.contacto_nombre, d.contacto_correo, d.telefono || ex.telefono, nowIso(), ex.id);
    return ex.id;
  }
  const r = q.run(`INSERT INTO empleadores(rut, razon_social, tipo, contacto_nombre, contacto_correo, telefono, acepta_condicion, acepta_at, creado_at)
    VALUES (?,?,?,?,?,?,1,?,?)`, rut, d.razon_social, d.tipo === 'municipal' ? 'municipal' : 'privado', d.contacto_nombre, d.contacto_correo, d.telefono, nowIso(), nowIso());
  const id = Number(r.lastInsertRowid);
  log({ usuario: actorName(actor), entidad: 'empleador', entidad_id: id, accion: 'registro y aceptación de condición de servicio', despues: { rut, razon_social: d.razon_social } });
  return id;
}

/** RN-09: cerrada sin respuesta en los últimos 12 meses. */
export function requiereAutorizacion(empleador_id) {
  const desde = addDays(today(), -PARAM.mesesRN09 * 30);
  return !!q.get(`SELECT 1 FROM ofertas WHERE empleador_id=? AND estado='cerrada_sin_respuesta' AND substr(cerrada_at,1,10) >= ?`, empleador_id, desde);
}

function ejecutivoConMenosCarga() {
  return q.get(`SELECT u.id FROM usuarios u LEFT JOIN ofertas o ON o.ejecutivo_id=u.id AND o.estado IN ('en_validacion','observada','publicada','derivada')
    WHERE u.rol='ejecutivo' AND u.activo=1 GROUP BY u.id ORDER BY COUNT(o.id), u.id LIMIT 1`)?.id || null;
}

export function crearOferta(d, actor = 'empleador') {
  return tx(() => {
    const emp = q.get('SELECT * FROM empleadores WHERE id=?', d.empleador_id);
    if (!emp) fail('CU-02', 'Empleador no registrado');
    if (!d.cargo) fail('CU-02', 'Falta el cargo');
    const reqs = (d.requisitos || []).filter((r) => r.descripcion?.trim());
    if (!reqs.length) fail('CU-02', 'Debe indicar al menos un requisito objetivo');
    const n = (q.get('SELECT COUNT(*) c FROM ofertas').c || 0) + 1;
    const codigo = `OF-${today().slice(0, 4)}-${String(n).padStart(4, '0')}`;
    const municipal = emp.tipo === 'municipal' ? 1 : 0;
    const reqAut = requiereAutorizacion(emp.id) ? 1 : 0;
    const r = q.run(`INSERT INTO ofertas(codigo, empleador_id, cargo, area, funciones, vacantes, condiciones, jornada, renta, comuna, municipal, estado, ejecutivo_id, requiere_autorizacion, creado_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'en_validacion',?,?,?)`, codigo, emp.id, d.cargo, d.area || null, d.funciones || null,
    Math.max(1, Number(d.vacantes) || 1), d.condiciones || null, d.jornada || null, d.renta || null, d.comuna || 'Casablanca',
    municipal, d.ejecutivo_id || ejecutivoConMenosCarga(), reqAut, nowIso());
    const id = Number(r.lastInsertRowid);
    for (const rq of reqs) {
      q.run('INSERT INTO requisitos(oferta_id, descripcion, tipo, categoria) VALUES (?,?,?,?)', id, rq.descripcion.trim(),
        rq.tipo === 'deseable' ? 'deseable' : 'excluyente', rq.categoria || 'otro');
    }
    if (municipal) {
      const ents = (d.entrevistadores || []).filter((e) => e.nombre?.trim());
      if (!ents.length) fail('P4', 'Una oferta municipal debe indicar quiénes participarán en la entrevista');
      for (const e of ents) q.run('INSERT INTO entrevistadores(oferta_id, nombre, correo) VALUES (?,?,?)', id, e.nombre.trim(), e.correo || null);
    }
    log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: id, oferta_id: id, accion: 'ingreso de oferta (CU-02)', despues: { codigo, cargo: d.cargo, municipal, requiere_autorizacion: reqAut } });
    return id;
  });
}

export function observarOferta(id, observacion, actor) {
  const o = getOferta(id);
  if (o.estado !== 'en_validacion') fail('7.2', 'Solo se observan ofertas en validación');
  if (!observacion?.trim()) fail('P1', 'Indique la observación para el empleador');
  setEstadoOferta(o, 'observada', actor, { observacion: observacion.trim() });
  send('E0', { destinatario: o.contacto_correo, empleador_id: o.empleador_id, oferta_id: o.id, vars: { ...varsOferta(o), observacion } });
}

/** Nueva versión de una oferta observada (o corrección en validación). Reemplaza los requisitos. */
export function nuevaVersionOferta(id, d, actor) {
  return tx(() => {
    const o = getOferta(id);
    if (!['observada', 'en_validacion'].includes(o.estado)) fail('7.2', 'Solo se corrigen ofertas en validación u observadas');
    const reqs = (d.requisitos || []).filter((r) => r.descripcion?.trim());
    if (!reqs.length) fail('CU-02', 'Debe indicar al menos un requisito objetivo');
    q.run(`UPDATE ofertas SET cargo=?, area=?, funciones=?, vacantes=?, condiciones=?, jornada=?, renta=?, version=version+1 WHERE id=?`,
      d.cargo || o.cargo, d.area ?? o.area, d.funciones ?? o.funciones, Math.max(1, Number(d.vacantes) || o.vacantes), d.condiciones ?? o.condiciones, d.jornada ?? o.jornada, d.renta ?? o.renta, id);
    const antes = q.all('SELECT descripcion, tipo FROM requisitos WHERE oferta_id=?', id);
    q.run('DELETE FROM requisitos WHERE oferta_id=?', id);
    for (const rq of reqs) q.run('INSERT INTO requisitos(oferta_id, descripcion, tipo, categoria) VALUES (?,?,?,?)', id, rq.descripcion.trim(), rq.tipo === 'deseable' ? 'deseable' : 'excluyente', rq.categoria || 'otro');
    log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: id, oferta_id: id, accion: `nueva versión v${o.version + 1}`, antes: { requisitos: antes }, despues: { requisitos: reqs } });
    if (o.estado === 'observada') setEstadoOferta(getOferta(id), 'en_validacion', actor, { observacion: null });
  });
}

export function autorizarOferta(id, actor) {
  const o = getOferta(id);
  if (!o.requiere_autorizacion) fail('RN-09', 'La oferta no requiere autorización');
  q.run('UPDATE ofertas SET autorizada_por=? WHERE id=?', actor.id, id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: id, oferta_id: id, accion: 'autorización de jefatura (RN-09)' });
}

export function publicarOferta(id, { fecha_cierre } = {}, actor) {
  return tx(() => {
    const o = getOferta(id);
    if (o.estado !== 'en_validacion') fail('7.2', 'Solo se publican ofertas en validación');
    if (o.requiere_autorizacion && !o.autorizada_por) fail('RN-09', 'El empleador tiene una oferta cerrada sin respuesta en los últimos 12 meses: requiere autorización de la jefatura OMIL');
    const obj = requisitosObjetables(id);
    if (obj.length) fail('P1.3', `Requisitos posiblemente discriminatorios: ${obj.map((r) => `"${r.descripcion}"`).join(', ')}. Observe la oferta.`);
    const hoy = today();
    let cierre = fecha_cierre || addBusinessDays(hoy, PARAM.diasHabilesPostulacion);
    if (cierre <= hoy) fail('P1.5', 'La fecha de cierre de postulación debe ser posterior a hoy');
    const derivacion = nextBusinessDay(cierre);
    setEstadoOferta(o, 'publicada', actor, { publicada_at: nowIso(), fecha_cierre_postulacion: cierre, fecha_derivacion: derivacion });
    const o2 = getOferta(id);
    send('E1', { destinatario: o2.contacto_correo, empleador_id: o2.empleador_id, oferta_id: id, vars: varsOferta(o2) });
  });
}

/** El empleador retira la oferta antes de la derivación, o la OMIL la anula. Aviso equivalente al A3. */
export function anularOferta(id, motivo, actor) {
  return tx(() => {
    const o = getOferta(id);
    if (!['en_validacion', 'observada', 'publicada'].includes(o.estado)) fail('7.2', 'Para ofertas derivadas el empleador informa "desierta" o "anulada" con su enlace');
    if (!motivo?.trim()) fail('7.2', 'Indique el motivo');
    q.run(`INSERT INTO resultados(oferta_id, fecha_informe, origen, tipo, comentario, validado_at, validado_por) VALUES (?,?,?,?,?,?,?)`,
      id, nowIso(), 'empleador', 'anulada', motivo, nowIso(), actor?.id || null);
    cerrarPostulacionesConAviso(o, 'A3D', 'no_seleccionada', actor, { motivo_cierre: 'anulado' });
    setEstadoOferta(o, 'desierta_anulada', actor, { cerrada_at: nowIso() });
  });
}

// ---------- postulación (P2) ----------
export function postular(d, actor = 'postulante') {
  return tx(() => {
    const o = getOferta(d.oferta_id);
    if (o.estado !== 'publicada') fail('7.2', 'La oferta no está recibiendo postulaciones');
    if (today() > o.fecha_cierre_postulacion) fail('P2', 'El plazo de postulación venció');
    if (!d.consentimiento_postular) fail('5', 'El consentimiento informado para postular es obligatorio');
    const rut = normRut(d.rut);
    if (!rut || !rutValido(rut)) fail('P2', 'RUT no válido');
    if (!d.nombre?.trim()) fail('P2', 'Falta el nombre');
    if (!d.correo?.trim() && !d.telefono?.trim()) fail('P2', 'Indique un correo o un teléfono de contacto');
    let persona = q.get('SELECT * FROM personas WHERE rut=?', rut);
    if (!persona) {
      const r = q.run(`INSERT INTO personas(rut, nombre, correo, telefono, comuna, grupo_prioritario, codigo_seguimiento, creado_at) VALUES (?,?,?,?,?,?,?,?)`,
        rut, d.nombre.trim(), d.correo?.trim() || null, d.telefono?.trim() || null, d.comuna || null, d.grupo_prioritario || null, codigoSeguimiento(), nowIso());
      persona = q.get('SELECT * FROM personas WHERE id=?', Number(r.lastInsertRowid));
      log({ usuario: actorName(actor), entidad: 'persona', entidad_id: persona.id, accion: 'registro de persona', despues: { rut: '***' } });
    } else {
      q.run('UPDATE personas SET nombre=?, correo=COALESCE(?, correo), telefono=COALESCE(?, telefono), comuna=COALESCE(?, comuna) WHERE id=?',
        d.nombre.trim(), d.correo?.trim() || null, d.telefono?.trim() || null, d.comuna || null, persona.id);
    }
    if (q.get('SELECT 1 FROM postulaciones WHERE persona_id=? AND oferta_id=?', persona.id, o.id)) fail('RN-16', 'Esta persona ya postuló a esta oferta');
    const r = q.run(`INSERT INTO postulaciones(persona_id, oferta_id, canal, creado_at, estado, registrado_por) VALUES (?,?,?,?, 'recibida', ?)`,
      persona.id, o.id, d.canal || 'portal', nowIso(), actor?.id || null);
    const pid = Number(r.lastInsertRowid);
    q.run(`INSERT INTO consentimientos(persona_id, tipo, version_texto, otorgado_at, estado) VALUES (?, 'postular', ?, ?, 'vigente')`, persona.id, PARAM.versionConsentimiento, nowIso());
    if (d.consentimiento_banco && !bancoVigente(persona.id)) {
      q.run(`INSERT INTO consentimientos(persona_id, tipo, version_texto, otorgado_at, estado) VALUES (?, 'banco_futuras', ?, ?, 'vigente')`, persona.id, PARAM.versionConsentimiento, nowIso());
    }
    log({ usuario: actorName(actor), entidad: 'postulacion', entidad_id: pid, oferta_id: o.id, accion: `postulación recibida (${d.canal || 'portal'})`, despues: { consentimiento_banco: !!d.consentimiento_banco } });
    // RN-04: Aviso 1 dentro de la hora (el MVP lo envía de inmediato)
    send('A1', { destinatario: persona.correo, postulacion_id: pid, oferta_id: o.id, vars: { ...varsOferta(o), nombre: persona.nombre, codigo: persona.codigo_seguimiento } });
    return { postulacion_id: pid, codigo: persona.codigo_seguimiento, persona_id: persona.id };
  });
}

// ---------- probidad (P4, RN-10, RN-11) ----------
export function declaracionDe(oferta_id, tipo, id) {
  return q.get('SELECT * FROM declaraciones WHERE oferta_id=? AND declarante_tipo=? AND declarante_id=?', oferta_id, tipo, id);
}
/** ¿Puede este funcionario ver datos personales de la oferta? */
export function accesoFuncionario(o, user) {
  if (!user) return { ok: false, motivo: 'Sin sesión' };
  if (user.rol === 'jefatura') {
    if (o.municipal) {
      const d = declaracionDe(o.id, 'usuario', user.id);
      if (!d) return { ok: false, motivo: 'RN-10: firme la declaración de vínculos para ver la nómina de esta oferta municipal', declarar: true };
      if (d.declara_vinculo) return { ok: false, motivo: 'RN-11: declaró vínculo con un postulante y quedó inhabilitado(a) en esta oferta' };
    }
    return { ok: true };
  }
  if (user.rol === 'ejecutivo') {
    if (o.ejecutivo_id !== user.id) return { ok: false, motivo: 'La oferta está asignada a otro ejecutivo/a' };
    if (o.municipal) {
      const d = declaracionDe(o.id, 'usuario', user.id);
      if (!d) return { ok: false, motivo: 'RN-10: firme la declaración de vínculos para ver la nómina de esta oferta municipal', declarar: true };
      if (d.declara_vinculo) return { ok: false, motivo: 'RN-11: declaró vínculo con un postulante y quedó inhabilitado(a). La jefatura debe reasignar la oferta.' };
    }
    return { ok: true };
  }
  if (user.rol === 'control') {
    const enMuestra = q.all('SELECT ofertas_json FROM muestras').some((m) => JSON.parse(m.ofertas_json).includes(o.id));
    return enMuestra ? { ok: true, soloLectura: true } : { ok: false, motivo: 'La Dirección de Control ve datos personales solo de ofertas en la muestra auditada' };
  }
  return { ok: false, motivo: 'Su rol no accede a datos personales de postulantes' };
}

export function declarar(oferta_id, { tipo, id, nombre, declara_vinculo, postulacion_relacionada_id, detalle, firma }, actor) {
  const o = getOferta(oferta_id);
  if (!o.municipal) fail('P4', 'La declaración de vínculos aplica a ofertas municipales');
  if (declaracionDe(oferta_id, tipo, id)) fail('CU-10', 'Ya existe una declaración de esta persona para esta oferta');
  if (!firma?.trim()) fail('CU-10', 'La declaración debe firmarse');
  const vinc = declara_vinculo ? 1 : 0;
  if (vinc && !postulacion_relacionada_id) fail('CU-10', 'Indique con qué postulante declara vínculo');
  q.run(`INSERT INTO declaraciones(oferta_id, declarante_tipo, declarante_id, nombre, fecha, declara_vinculo, postulacion_relacionada_id, detalle, abstencion, firma)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, oferta_id, tipo, id, nombre, nowIso(), vinc, vinc ? Number(postulacion_relacionada_id) : null, detalle || null, vinc, firma.trim());
  log({ usuario: actorName(actor || nombre), entidad: 'declaracion', oferta_id, accion: vinc ? 'declaración CON vínculo · abstención registrada (RN-11)' : 'declaración sin vínculo', despues: { declarante: nombre, tipo } });
}

export function reasignarEjecutivo(oferta_id, nuevo_id, actor) {
  const o = getOferta(oferta_id);
  const u = q.get(`SELECT * FROM usuarios WHERE id=? AND rol='ejecutivo' AND activo=1`, nuevo_id);
  if (!u) fail('—', 'Ejecutivo/a no válido');
  if (o.municipal) {
    const d = declaracionDe(o.id, 'usuario', u.id);
    if (d?.declara_vinculo) fail('RN-11', `${u.nombre} declaró vínculo en esta oferta y no puede asignarse`);
  }
  q.run('UPDATE ofertas SET ejecutivo_id=? WHERE id=?', u.id, o.id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: o.id, oferta_id: o.id, accion: 'reasignación de ejecutivo/a', antes: { ejecutivo: o.ejecutivo_nombre }, despues: { ejecutivo: u.nombre } });
}

export function reemplazarEntrevistador(oferta_id, entrevistador_id, { nombre, correo }, actor) {
  const e = q.get('SELECT * FROM entrevistadores WHERE id=? AND oferta_id=? AND activo=1', entrevistador_id, oferta_id);
  if (!e) fail('—', 'Entrevistador no encontrado');
  if (!nombre?.trim()) fail('—', 'Indique el reemplazo');
  q.run('UPDATE entrevistadores SET activo=0 WHERE id=?', e.id);
  q.run('INSERT INTO entrevistadores(oferta_id, nombre, correo, reemplaza_a) VALUES (?,?,?,?)', oferta_id, nombre.trim(), correo || null, e.id);
  log({ usuario: actorName(actor), entidad: 'entrevistador', entidad_id: e.id, oferta_id, accion: 'reemplazo de entrevistador por abstención (P4.3)', antes: { nombre: e.nombre }, despues: { nombre } });
}

/** RN-10 en el canal de la Dirección: todos los entrevistadores activos declararon sin vínculo. */
export function estadoDeclaracionesEntrevistadores(oferta_id) {
  const ents = q.all('SELECT * FROM entrevistadores WHERE oferta_id=? AND activo=1', oferta_id);
  const lista = ents.map((e) => ({ ...e, decl: declaracionDe(oferta_id, 'entrevistador', e.id) }));
  const completo = lista.length > 0 && lista.every((e) => e.decl && !e.decl.declara_vinculo);
  return { lista, completo };
}

// ---------- clasificación (RN-01, RN-03) ----------
export function calcularClasificacion(postulacion_id) {
  const p = q.get('SELECT * FROM postulaciones WHERE id=?', postulacion_id);
  const excl = q.all(`SELECT r.id, e.resultado FROM requisitos r LEFT JOIN evaluaciones e ON e.requisito_id=r.id AND e.postulacion_id=?
    WHERE r.oferta_id=? AND r.tipo='excluyente'`, postulacion_id, p.oferta_id);
  return excl.every((r) => r.resultado === 'acredita') ? 'cumple' : 'no_cumple';
}

export function clasificar(postulacion_id, evals, { clasif_final, justificacion } = {}, actor) {
  return tx(() => {
    const p = q.get('SELECT * FROM postulaciones WHERE id=?', postulacion_id);
    if (!p) fail('—', 'Postulación no encontrada');
    const o = getOferta(p.oferta_id);
    if (actor?.rol) {
      const acc = accesoFuncionario(o, actor);
      if (!acc.ok || acc.soloLectura) fail('RN-10', acc.motivo || 'Sin permiso para clasificar');
    }
    if (!['recibida', 'clasificada'].includes(p.estado)) fail('7.2', 'Solo se clasifican postulaciones recibidas o clasificadas, antes de la derivación');
    const reqs = q.all('SELECT * FROM requisitos WHERE oferta_id=?', p.oferta_id);
    for (const r of reqs) {
      const ev = evals[r.id];
      if (!ev?.resultado) continue;
      if (r.tipo === 'excluyente' && ev.resultado !== 'acredita' && !ev.motivo) fail('M4', `Indique el motivo codificado para "${r.descripcion}"`);
      q.run(`INSERT INTO evaluaciones(postulacion_id, requisito_id, resultado, motivo) VALUES (?,?,?,?)
        ON CONFLICT(postulacion_id, requisito_id) DO UPDATE SET resultado=excluded.resultado, motivo=excluded.motivo`,
      p.id, r.id, ev.resultado, ev.resultado === 'acredita' ? null : (ev.motivo || null));
    }
    const faltan = reqs.filter((r) => r.tipo === 'excluyente' && !q.get('SELECT 1 FROM evaluaciones WHERE postulacion_id=? AND requisito_id=?', p.id, r.id));
    if (faltan.length) fail('M4', 'Evalúe todos los requisitos excluyentes');
    const calc = calcularClasificacion(p.id);
    const final = clasif_final && clasif_final !== calc ? clasif_final : calc;
    if (final !== calc && !justificacion?.trim()) fail('RN-03', 'Corregir la clasificación calculada exige una justificación');
    q.run(`UPDATE postulaciones SET clasif_calculada=?, clasif_final=?, justificacion_cambio=?, estado='clasificada' WHERE id=?`,
      calc, final, final !== calc ? justificacion.trim() : null, p.id);
    log({ usuario: actorName(actor), entidad: 'postulacion', entidad_id: p.id, oferta_id: o.id,
      accion: final !== calc ? `clasificación corregida a mano (RN-03): ${final}` : `clasificación: ${final}`,
      antes: { estado: p.estado, clasif_final: p.clasif_final }, despues: { calculada: calc, final, justificacion: final !== calc ? justificacion : undefined } });
  });
}

// ---------- derivación (CU-07) ----------
export function derivar(oferta_id, actor = 'sistema') {
  return tx(() => {
    const o = getOferta(oferta_id);
    if (o.estado !== 'publicada') fail('7.2', 'Solo se derivan ofertas publicadas');
    const posts = q.all(`SELECT p.*, pe.nombre, pe.rut, pe.correo, pe.telefono, pe.comuna FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id
      WHERE p.oferta_id=? AND p.estado IN ('recibida','clasificada') ORDER BY p.id`, o.id);
    const nomina = posts.map((p) => ({
      postulacion_id: p.id, nombre: p.nombre, rut: p.rut, correo: p.correo, telefono: p.telefono, comuna: p.comuna,
      clasificacion: p.clasif_final || 'sin clasificar',
      requisitos: q.all(`SELECT r.descripcion, r.tipo, COALESCE(e.resultado,'no_informado') resultado FROM requisitos r
        LEFT JOIN evaluaciones e ON e.requisito_id=r.id AND e.postulacion_id=? WHERE r.oferta_id=?`, p.id, o.id),
    }));
    const huella = sha(nomina);
    const tk = token();
    const hoy = today();
    q.run(`INSERT INTO derivaciones(oferta_id, fecha, huella, token, vence, n_postulantes, nomina_json) VALUES (?,?,?,?,?,?,?)`,
      o.id, nowIso(), huella, tk, addDays(hoy, PARAM.diasCierreAuto), nomina.length, JSON.stringify(nomina));
    setEstadoOferta(o, 'derivada', actor, { derivada_at: nowIso() });
    const o2 = getOferta(o.id);
    for (const p of posts) {
      setEstadoPost(p, 'derivada', actor, o.id);
      send('A2', { destinatario: p.correo, postulacion_id: p.id, oferta_id: o.id, vars: { ...varsOferta(o2), nombre: p.nombre, fecha_derivacion: fmtDate(hoy) } });
    }
    send('E2', { destinatario: o.contacto_correo, empleador_id: o.empleador_id, oferta_id: o.id,
      vars: { ...varsOferta(o2), n_postulantes: nomina.length, enlace: enlaceEmpleador(tk), fecha_vence: fmtDate(addDays(hoy, PARAM.diasCierreAuto)) } });
    log({ usuario: actorName(actor), entidad: 'derivacion', oferta_id: o.id, accion: 'nómina derivada', despues: { n: nomina.length, huella } });
    return tk;
  });
}
export const enlaceEmpleador = (tk) => `${process.env.TRAZA_URL || 'http://localhost:3000'}/e/${tk}`;
export const derivacionDe = (oferta_id) => q.get('SELECT * FROM derivaciones WHERE oferta_id=?', oferta_id);

// ---------- resultado (CU-08, CU-11, RN-12, RN-13) ----------
export function informarResultado(tk, d, actor = 'empleador') {
  return tx(() => {
    const der = q.get('SELECT * FROM derivaciones WHERE token=?', tk);
    if (!der) fail('—', 'Enlace no válido');
    const o = getOferta(der.oferta_id);
    if (o.estado !== 'derivada') fail('7.2', 'La oferta ya no espera resultado');
    if (resultadoVigente(o.id)) fail('CU-08', 'El resultado ya fue informado y está en validación por la OMIL');
    const tipo = ['contratacion', 'desierta', 'anulada'].includes(d.tipo) ? d.tipo : fail('CU-08', 'Tipo de resultado no válido');
    const nomina = JSON.parse(der.nomina_json);
    const ids = new Set(nomina.map((n) => n.postulacion_id));
    const contratados = tipo === 'contratacion' ? [...new Set((d.contratados || []).map(Number))] : [];
    if (tipo === 'contratacion' && !contratados.length) fail('CU-08', 'Indique a quiénes contrató');
    if (contratados.some((c) => !ids.has(c))) fail('CU-08', 'Solo puede informar personas de la nómina derivada');
    if (o.municipal) {
      const est = estadoDeclaracionesEntrevistadores(o.id);
      if (!est.completo) fail('RN-10', 'Faltan declaraciones de vínculos de los entrevistadores');
      if (tipo === 'contratacion') {
        const a = d.acta || {};
        if (!a.criterio?.trim() || !a.firmantes?.trim() || !(a.entrevistados || []).length) fail('RN-12', 'El resultado de una oferta municipal no se acepta sin acta de selección (entrevistados, criterio y firmantes)');
        const noCumple = nomina.filter((n) => contratados.includes(n.postulacion_id) && n.clasificacion !== 'cumple');
        if (noCumple.length && !a.justificacion_no_cumple?.trim()) fail('RN-13', 'Seleccionó a una persona clasificada "no cumple": debe justificarlo en el acta');
        q.run(`INSERT INTO actas(oferta_id, entrevistados_json, criterio, seleccionados_json, firmantes, documento, justificacion_no_cumple, creado_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(oferta_id) DO UPDATE SET entrevistados_json=excluded.entrevistados_json, criterio=excluded.criterio, seleccionados_json=excluded.seleccionados_json,
          firmantes=excluded.firmantes, documento=excluded.documento, justificacion_no_cumple=excluded.justificacion_no_cumple, creado_at=excluded.creado_at`,
        o.id, JSON.stringify(a.entrevistados.map(Number)), a.criterio.trim(), JSON.stringify(contratados), a.firmantes.trim(), a.documento || null, a.justificacion_no_cumple || null, nowIso());
        log({ usuario: actorName(actor), entidad: 'acta', oferta_id: o.id, accion: 'acta de selección cargada (CU-11)', despues: { entrevistados: a.entrevistados.length, seleccionados: contratados.length } });
        if (noCumple.length) {
          q.run(`UPDATE ofertas SET marcada_control=1, motivo_marca=? WHERE id=?`, 'RN-13: seleccionado clasificado "no cumple"', o.id);
          log({ usuario: 'sistema', entidad: 'oferta', entidad_id: o.id, oferta_id: o.id, accion: 'marcada para muestra de Control (RN-13)' });
        }
      }
    }
    q.run(`INSERT INTO resultados(oferta_id, fecha_informe, origen, tipo, contratados_json, comentario) VALUES (?,?,?,?,?,?)`,
      o.id, nowIso(), 'empleador', tipo, JSON.stringify(contratados), d.comentario || null);
    log({ usuario: actorName(actor), entidad: 'resultado', oferta_id: o.id, accion: `resultado informado por el empleador: ${tipo}`, despues: { contratados: contratados.length } });
  });
}

/** El ejecutivo valida el resultado y el sistema cierra con Aviso 3 (RN-06). */
export function validarResultado(oferta_id, actor) {
  return tx(() => {
    const o = getOferta(oferta_id);
    const res = resultadoVigente(o.id);
    if (o.estado !== 'derivada' || !res || res.validado_at) fail('CU-09', 'No hay resultado pendiente de validar');
    const contratados = JSON.parse(res.contratados_json);
    q.run('UPDATE resultados SET validado_at=?, validado_por=? WHERE id=?', nowIso(), actor?.id || null, res.id);
    if (res.tipo === 'contratacion') {
      for (const p of q.all(`SELECT * FROM postulaciones WHERE oferta_id=? AND estado='derivada'`, o.id)) {
        if (contratados.includes(p.id)) setEstadoPost(p, 'seleccionada', actor, o.id);
      }
      cerrarPostulacionesConAviso(o, 'A3', 'no_seleccionada', actor);
      setEstadoOferta(o, 'cerrada_con_resultado', actor, { cerrada_at: nowIso() });
    } else {
      cerrarPostulacionesConAviso(o, 'A3D', 'no_seleccionada', actor, { motivo_cierre: res.tipo === 'desierta' ? 'desierto' : 'anulado' });
      setEstadoOferta(o, 'desierta_anulada', actor, { cerrada_at: nowIso() });
    }
  });
}

function cerrarPostulacionesConAviso(o, plantilla, estado, actor, extra = {}) {
  const posts = q.all(`SELECT p.*, pe.nombre, pe.correo FROM postulaciones p JOIN personas pe ON pe.id=p.persona_id
    WHERE p.oferta_id=? AND p.estado IN ('recibida','clasificada','derivada')`, o.id);
  const ofresh = getOferta(o.id);
  for (const p of posts) {
    setEstadoPost(p, estado, actor, o.id);
    send(plantilla, { destinatario: p.correo, postulacion_id: p.id, oferta_id: o.id,
      vars: { ...varsOferta(ofresh), ...extra, nombre: p.nombre, banco: bancoVigente(p.persona_id) } });
  }
}

/** RN-07: cierre a los 30 días corridos sin resultado. */
export function cerrarSinRespuesta(oferta_id, actor = 'sistema') {
  return tx(() => {
    const o = getOferta(oferta_id);
    if (o.estado !== 'derivada') fail('7.2', 'Solo se cierran por plazo ofertas derivadas');
    q.run(`INSERT INTO resultados(oferta_id, fecha_informe, origen, tipo, validado_at) VALUES (?,?,?,?,?)`, o.id, nowIso(), 'cierre_automatico', 'sin_respuesta', nowIso());
    cerrarPostulacionesConAviso(o, 'A4', 'cerrada_sin_resultado', actor);
    setEstadoOferta(o, 'cerrada_sin_respuesta', actor, { cerrada_at: nowIso() });
    q.run(`UPDATE empleadores SET estado_cumplimiento='sin_resultado_informado' WHERE id=?`, o.empleador_id);
    log({ usuario: actorName(actor), entidad: 'empleador', entidad_id: o.empleador_id, oferta_id: o.id, accion: 'marcado "sin resultado informado" (RN-09)' });
    send('E4', { destinatario: o.contacto_correo, empleador_id: o.empleador_id, oferta_id: o.id, vars: varsOferta(getOferta(o.id)) });
  });
}

/** RN-14: solo la jefatura reabre, con justificación. Vuelve a "derivada" con un nuevo plazo de 30 días. */
export function reabrirOferta(oferta_id, justificacion, actor) {
  return tx(() => {
    if (actor?.rol !== 'jefatura') fail('RN-14', 'Solo la jefatura OMIL puede reabrir una oferta cerrada');
    if (!justificacion?.trim()) fail('RN-14', 'La reapertura exige justificación');
    const o = getOferta(oferta_id);
    if (!['cerrada_con_resultado', 'cerrada_sin_respuesta'].includes(o.estado)) fail('7.2', 'Solo se reabren ofertas cerradas con resultado o sin respuesta');
    q.run('UPDATE resultados SET vigente=0 WHERE oferta_id=?', o.id);
    q.run(`UPDATE derivaciones SET vence=? WHERE oferta_id=?`, addDays(today(), PARAM.diasCierreAuto), o.id);
    for (const p of q.all(`SELECT * FROM postulaciones WHERE oferta_id=? AND estado IN ('seleccionada','no_seleccionada','cerrada_sin_resultado')`, o.id)) setEstadoPost(p, 'derivada', actor, o.id);
    setEstadoOferta(o, 'derivada', actor, { derivada_at: nowIso(), cerrada_at: null, recordatorio10: 0, recordatorio20: 0 });
    log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: o.id, oferta_id: o.id, accion: 'reapertura excepcional (RN-14)', despues: { justificacion } });
  });
}

// ---------- postulante: retiro y consentimientos ----------
export function retirarPostulacion(persona_id, postulacion_id) {
  const p = q.get('SELECT * FROM postulaciones WHERE id=? AND persona_id=?', postulacion_id, persona_id);
  if (!p) fail('—', 'Postulación no encontrada');
  if (!['recibida', 'clasificada', 'derivada'].includes(p.estado)) fail('7.2', 'La postulación ya está cerrada');
  setEstadoPost(p, 'retirada', 'postulante', p.oferta_id);
}
export function revocarConsentimiento(persona_id, tipo) {
  const c = q.get(`SELECT * FROM consentimientos WHERE persona_id=? AND tipo=? AND estado='vigente'`, persona_id, tipo);
  if (!c) fail('RN-18', 'No hay consentimiento vigente de ese tipo');
  q.run(`UPDATE consentimientos SET estado='revocado', revocado_at=? WHERE persona_id=? AND tipo=? AND estado='vigente'`, nowIso(), persona_id, tipo);
  log({ usuario: 'postulante', entidad: 'consentimiento', entidad_id: c.id, accion: `revocación de consentimiento ${tipo} (RN-18)` });
}
export function otorgarBanco(persona_id) {
  if (bancoVigente(persona_id)) return;
  q.run(`INSERT INTO consentimientos(persona_id, tipo, version_texto, otorgado_at, estado) VALUES (?, 'banco_futuras', ?, ?, 'vigente')`, persona_id, PARAM.versionConsentimiento, nowIso());
  log({ usuario: 'postulante', entidad: 'consentimiento', accion: 'otorga consentimiento banco de futuras ofertas (RN-18)' });
}

// ---------- OIRS y BNE ----------
export function vincularOIRS(oferta_id, caso, actor) {
  if (!caso?.trim()) fail('P6', 'Indique el número de caso OIRS');
  q.run('UPDATE ofertas SET congelada=1, caso_oirs=? WHERE id=?', caso.trim(), oferta_id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: oferta_id, oferta_id, accion: `denuncia OIRS ${caso} vinculada · expediente congelado (P6)` });
}
export function liberarOIRS(oferta_id, actor) {
  q.run('UPDATE ofertas SET congelada=0 WHERE id=?', oferta_id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: oferta_id, oferta_id, accion: 'investigación OIRS terminada · expediente liberado' });
}
export function marcarBNE(oferta_id, actor) {
  q.run('UPDATE ofertas SET registrada_bne=1 WHERE id=?', oferta_id);
  log({ usuario: actorName(actor), entidad: 'oferta', entidad_id: oferta_id, oferta_id, accion: 'contrataciones registradas en BNE' });
}

// ---------- derechos de los titulares (CU-15) y conservación (RN-19) ----------
export function solicitudTitular(persona_id, tipo, detalle) {
  const r = q.run(`INSERT INTO solicitudes_titular(persona_id, tipo, detalle, fecha, plazo, estado) VALUES (?,?,?,?,?, 'pendiente')`,
    persona_id, tipo, detalle || null, nowIso(), addDays(today(), PARAM.diasPlazoTitular));
  log({ usuario: 'postulante', entidad: 'solicitud_titular', entidad_id: Number(r.lastInsertRowid), accion: `solicitud de ${tipo}` });
}
export function resolverSolicitud(id, { estado, respuesta, anonimizar }, actor) {
  const s = q.get('SELECT * FROM solicitudes_titular WHERE id=?', id);
  if (!s || s.estado !== 'pendiente') fail('CU-15', 'Solicitud no pendiente');
  if (anonimizar) {
    const r = anonimizarPersona(s.persona_id, 'supresión solicitada por el titular', actor);
    if (!r.ok) fail('P6', r.motivo);
  }
  q.run('UPDATE solicitudes_titular SET estado=?, respuesta=?, resuelto_at=? WHERE id=?', estado === 'rechazada' ? 'rechazada' : 'resuelta', respuesta || null, nowIso(), id);
  log({ usuario: actorName(actor), entidad: 'solicitud_titular', entidad_id: id, accion: `solicitud ${estado === 'rechazada' ? 'rechazada' : 'resuelta'}` });
}
export function anonimizarPersona(persona_id, motivo, actor = 'sistema') {
  const congelada = q.get(`SELECT o.codigo FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id WHERE p.persona_id=? AND o.congelada=1`, persona_id);
  if (congelada) return { ok: false, motivo: `Expediente ${congelada.codigo} congelado por denuncia OIRS` };
  const activa = q.get(`SELECT 1 FROM postulaciones WHERE persona_id=? AND estado IN ('recibida','clasificada','derivada')`, persona_id);
  if (activa) return { ok: false, motivo: 'La persona tiene postulaciones en curso' };
  q.run(`UPDATE personas SET rut=NULL, nombre='[datos eliminados]', correo=NULL, telefono=NULL, comuna=NULL, grupo_prioritario=NULL, anonimizada=1 WHERE id=?`, persona_id);
  q.run(`UPDATE consentimientos SET estado='revocado', revocado_at=COALESCE(revocado_at, ?) WHERE persona_id=?`, nowIso(), persona_id);
  log({ usuario: actorName(actor), entidad: 'persona', entidad_id: persona_id, accion: `anonimización: ${motivo}` });
  return { ok: true };
}
function aplicarConservacion() {
  const limite = addDays(today(), -PARAM.mesesConservacion * 30);
  const candidatos = q.all(`SELECT pe.id FROM personas pe WHERE pe.anonimizada=0
    AND NOT EXISTS (SELECT 1 FROM consentimientos c WHERE c.persona_id=pe.id AND c.tipo='banco_futuras' AND c.estado='vigente')
    AND NOT EXISTS (SELECT 1 FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id WHERE p.persona_id=pe.id
        AND (o.cerrada_at IS NULL OR substr(o.cerrada_at,1,10) > ? OR o.congelada=1))
    AND EXISTS (SELECT 1 FROM postulaciones p WHERE p.persona_id=pe.id)`, limite);
  for (const c of candidatos) anonimizarPersona(c.id, `plazo de conservación vencido (RN-19, ${PARAM.mesesConservacion} meses)`);
  return candidatos.length;
}

// ---------- motor de temporizadores (M6) ----------
export function tick() {
  const hoy = today();
  const out = { derivadas: 0, recordatorios: 0, cierres: 0, alertas: 0, anonimizadas: 0 };
  // Fin del plazo de postulación → derivación (y alerta I1 un día hábil antes)
  for (const o of q.all(`SELECT id FROM ofertas WHERE estado='publicada'`).map((r) => getOferta(r.id))) {
    if (hoy >= o.fecha_derivacion) {
      derivar(o.id);
      out.derivadas++;
    } else if (!o.alerta_i1 && businessDaysBetween(hoy, o.fecha_derivacion) <= 1) {
      const pend = q.get(`SELECT COUNT(*) c FROM postulaciones WHERE oferta_id=? AND estado='recibida'`, o.id).c;
      if (pend > 0 && o.ejecutivo_id) {
        const u = q.get('SELECT * FROM usuarios WHERE id=?', o.ejecutivo_id);
        send('I1', { destinatario: u.correo, usuario_id: u.id, oferta_id: o.id, interno: true, vars: { ...varsOferta(o), pendientes: pend } });
        out.alertas++;
      }
      q.run('UPDATE ofertas SET alerta_i1=1 WHERE id=?', o.id);
    }
  }
  // Seguimiento de ofertas derivadas: recordatorios 10/20, I2 y cierre a 30 días
  for (const o of q.all(`SELECT id FROM ofertas WHERE estado='derivada'`).map((r) => getOferta(r.id))) {
    const dias = calendarDaysBetween(toDate(o.derivada_at), hoy);
    const res = resultadoVigente(o.id);
    const der = derivacionDe(o.id);
    if (res && !res.validado_at) {
      const dh = businessDaysBetween(toDate(res.fecha_informe), hoy);
      if (dh >= PARAM.diasHabilesAviso3 - 1 && !res.alerta_i2) {
        const destinatarios = q.all(`SELECT * FROM usuarios WHERE (id=? OR rol='jefatura') AND activo=1`, o.ejecutivo_id);
        for (const u of destinatarios) {
          send('I2', { destinatario: u.correo, usuario_id: u.id, oferta_id: o.id, interno: true,
            vars: { ...varsOferta(o), fecha_informe: fmtDate(toDate(res.fecha_informe)), fecha_limite: fmtDate(addBusinessDays(toDate(res.fecha_informe), PARAM.diasHabilesAviso3)) } });
        }
        q.run('UPDATE resultados SET alerta_i2=1 WHERE id=?', res.id);
        out.alertas++;
      }
      continue; // el empleador ya informó: no corren recordatorios ni cierre automático
    }
    if (res) continue;
    if (dias >= PARAM.diasCierreAuto) { cerrarSinRespuesta(o.id); out.cierres++; continue; }
    for (const [i, d] of PARAM.recordatorios.entries()) {
      const col = i === 0 ? 'recordatorio10' : 'recordatorio20';
      if (dias >= d && !o[col]) {
        send('E3', { destinatario: o.contacto_correo, empleador_id: o.empleador_id, oferta_id: o.id,
          vars: { ...varsOferta(o), dias: d, enlace: enlaceEmpleador(der.token), fecha_vence: fmtDate(addDays(toDate(o.derivada_at), PARAM.diasCierreAuto)) } });
        q.run(`UPDATE ofertas SET ${col}=1 WHERE id=?`, o.id);
        out.recordatorios++;
      }
    }
  }
  out.anonimizadas = aplicarConservacion();
  if (Object.values(out).some(Boolean)) log({ entidad: 'motor', accion: 'ejecución de temporizadores', despues: out });
  return out;
}

// ---------- muestra de auditoría (P5, CU-13) ----------
function prng(seed) {
  let a = parseInt(sha(seed).slice(0, 8), 16);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function rangoSemestre(semestre) {
  const [y, s] = semestre.split('-S');
  return s === '1' ? [`${y}-01-01`, `${y}-06-30`] : [`${y}-07-01`, `${y}-12-31`];
}
export function seleccionarMuestra(semestre, semilla) {
  const [desde, hasta] = rangoSemestre(semestre);
  const pob = q.all(`SELECT id, municipal, marcada_control FROM ofertas WHERE estado IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada')
    AND substr(cerrada_at,1,10) BETWEEN ? AND ? ORDER BY id`, desde, hasta);
  const n = Math.min(pob.length, Math.max(5, Math.ceil(pob.length * 0.2)));
  const marcadas = pob.filter((o) => o.marcada_control).map((o) => o.id);
  const resto = pob.filter((o) => !o.marcada_control);
  const rnd = prng(`${semestre}|${semilla}`);
  // muestreo ponderado sin reemplazo: municipales pesan 3, privadas 1
  const keyed = resto.map((o) => ({ id: o.id, k: Math.pow(rnd(), 1 / (o.municipal ? 3 : 1)) })).sort((a, b) => b.k - a.k);
  const elegidas = [...marcadas, ...keyed.slice(0, Math.max(0, n - marcadas.length)).map((x) => x.id)];
  return { poblacion: pob.length, elegidas };
}
export function generarMuestra(semestre, semilla, actor) {
  if (!/^\d{4}-S[12]$/.test(semestre)) fail('CU-13', 'Semestre con formato AAAA-S1 o AAAA-S2');
  const seed = semilla?.trim() || randomBytes(6).toString('hex');
  const { poblacion, elegidas } = seleccionarMuestra(semestre, seed);
  if (!elegidas.length) fail('CU-13', 'No hay ofertas cerradas en ese semestre');
  const r = q.run('INSERT INTO muestras(semestre, semilla, ofertas_json, creado_por, creado_at) VALUES (?,?,?,?,?)', semestre, seed, JSON.stringify(elegidas), actor?.id || null, nowIso());
  log({ usuario: actorName(actor), entidad: 'muestra', entidad_id: Number(r.lastInsertRowid), accion: `muestra ${semestre} generada`, despues: { semilla: seed, poblacion, muestra: elegidas.length } });
  return Number(r.lastInsertRowid);
}
export function registrarHallazgo(muestra_id, oferta_id, descripcion, gravedad, actor) {
  if (!descripcion?.trim()) fail('P5', 'Describa el hallazgo');
  q.run('INSERT INTO hallazgos(muestra_id, oferta_id, descripcion, gravedad, registrado_por, fecha) VALUES (?,?,?,?,?,?)', muestra_id, oferta_id, descripcion.trim(), gravedad, actor.id, nowIso());
  log({ usuario: actorName(actor), entidad: 'hallazgo', oferta_id, accion: `hallazgo ${gravedad} registrado (P5)` });
}
export function responderHallazgo(id, plan, actor) {
  if (!plan?.trim()) fail('P5', 'Indique el plan de acción');
  q.run('UPDATE hallazgos SET plan_accion=?, respondido_por=?, respondido_at=? WHERE id=?', plan.trim(), actor.id, nowIso(), id);
  const h = q.get('SELECT * FROM hallazgos WHERE id=?', id);
  log({ usuario: actorName(actor), entidad: 'hallazgo', entidad_id: id, oferta_id: h.oferta_id, accion: 'plan de acción de jefatura (P5.4)' });
}

export { isBusinessDay };
