// Notificaciones (M7): plantillas versionadas, envío y registro de entrega/rebote.
// En el MVP el "envío" queda en la bandeja de salida (tabla avisos); el conector SMTP/servicio
// masivo con SPF/DKIM/DMARC se enchufa en deliver().
import { q } from './db.js';
import { nowIso } from './clock.js';
import { log } from './audit.js';

export const CONTACTO = 'omilpersonas@municipalidadcasablanca.cl · 32 2277406';

export const PLANTILLAS_BASE = [
  ['A1', 'Aviso 1 · Recepción (postulante)', 'Postulación a {{cargo}} — recibida',
    `Hola {{nombre}}. Recibimos su postulación al cargo {{cargo}} en {{empleador}}.
Sus antecedentes se enviarán al empleador el {{fecha_derivacion}}. Puede consultar el estado de su postulación en "Mis postulaciones" con su RUT y el código de seguimiento {{codigo}}.
Consultas: {{contacto}}.`],
  ['A2', 'Aviso 2 · Derivación (postulante)', 'Postulación a {{cargo}} — antecedentes enviados al empleador',
    `Hola {{nombre}}. Hoy, {{fecha_derivacion}}, enviamos sus antecedentes a {{empleador}} para el cargo {{cargo}}.
La entrevista y la selección las decide el empleador. Le avisaremos cuando el proceso termine.
Consultas: {{contacto}}.`],
  ['A3', 'Aviso 3 · Proceso finalizado (no seleccionados)', 'Postulación a {{cargo}} — proceso finalizado',
    `Hola {{nombre}}. El proceso de selección para {{cargo}} en {{empleador}} finalizó y en esta oportunidad no fue seleccionado(a). Sus antecedentes se enviaron al empleador el {{fecha_derivacion}}.{{#banco}} Sus antecedentes siguen registrados en la OMIL para futuras ofertas.{{/banco}}
Si quiere mejorar sus opciones, lo invitamos al taller de currículum de {{mes_taller}}.
Consultas: {{contacto}}.`],
  ['A3D', 'Aviso 3 · Oferta desierta o anulada', 'Postulación a {{cargo}} — proceso finalizado',
    `Hola {{nombre}}. El empleador {{empleador}} informó que el proceso para {{cargo}} quedó {{motivo_cierre}}, por lo que el proceso finalizó sin contratación. Sus antecedentes se enviaron al empleador el {{fecha_derivacion}}.{{#banco}} Sus antecedentes siguen registrados en la OMIL para futuras ofertas.{{/banco}}
Lo invitamos al taller de currículum de {{mes_taller}}.
Consultas: {{contacto}}.`],
  ['A4', 'Aviso 4 · Cierre sin respuesta del empleador', 'Postulación a {{cargo}} — proceso cerrado',
    `Hola {{nombre}}. El empleador no informó el resultado del proceso para {{cargo}} dentro de 30 días desde que recibió los antecedentes, por lo que la OMIL da el proceso por cerrado. Si el empleador lo contacta igualmente, su postulación sigue siendo válida para él.
Consultas: {{contacto}}.`],
  ['E0', 'E0 · Oferta observada (empleador)', 'Oferta {{codigo_oferta}} — observaciones de la OMIL',
    `Estimado(a) {{contacto_empleador}}: revisamos su oferta {{cargo}} y requiere correcciones antes de publicarse:
{{observacion}}
Los requisitos deben ser objetivos y no pueden discriminar por sexo, edad, estado civil u otra condición prohibida por el artículo 2 del Código del Trabajo. Responda a este correo con la versión corregida.`],
  ['E1', 'E1 · Oferta publicada (empleador)', 'Oferta {{codigo_oferta}} publicada — {{cargo}}',
    `Estimado(a) {{contacto_empleador}}: su oferta {{cargo}} fue publicada.
Postulaciones hasta el {{fecha_cierre}}. Derivación de la nómina: {{fecha_derivacion}}.
Recuerde la condición de servicio: debe informar el resultado del proceso. Si no lo hace dentro de 30 días corridos desde la derivación, la OMIL cerrará el proceso.`],
  ['E2', 'E2 · Derivación de nómina (empleador)', 'Nómina de postulantes — {{cargo}} ({{codigo_oferta}})',
    `Estimado(a) {{contacto_empleador}}: le enviamos la nómina completa de {{n_postulantes}} postulantes para {{cargo}}, con la clasificación "cumple / no cumple" según los requisitos excluyentes.
Informe el resultado con este enlace único (no requiere cuenta): {{enlace}}
Plazo para informar: {{fecha_vence}}.`],
  ['E3', 'E3 · Recordatorio (empleador)', 'Recordatorio: informe el resultado de {{cargo}}',
    `Estimado(a) {{contacto_empleador}}: han pasado {{dias}} días desde que recibió la nómina de {{cargo}}. Aún no informa el resultado.
Si no lo informa antes del {{fecha_vence}}, la oferta se cerrará automáticamente. Enlace: {{enlace}}`],
  ['E4', 'E4 · Cierre sin respuesta (empleador)', 'Oferta {{codigo_oferta}} cerrada sin resultado informado',
    `Estimado(a) {{contacto_empleador}}: la oferta {{cargo}} se cerró porque no se informó el resultado dentro de 30 días corridos.
Su organización queda registrada como "sin resultado informado": durante los próximos 12 meses, toda nueva oferta requerirá autorización de la jefatura OMIL (RN-09).`],
  ['I1', 'I1 · Plazo de clasificación por vencer (interno)', '[Traza OMIL] {{codigo_oferta}}: {{pendientes}} postulaciones sin clasificar',
    `La oferta {{codigo_oferta}} ({{cargo}}) se deriva el {{fecha_derivacion}} y tiene {{pendientes}} postulaciones sin clasificar.`],
  ['I2', 'I2 · Aviso 3 por vencer (interno)', '[Traza OMIL] {{codigo_oferta}}: resultado recibido sin cierre',
    `El empleador informó el resultado de {{codigo_oferta}} ({{cargo}}) el {{fecha_informe}} y el cierre no se ha ejecutado. El Aviso 3 vence el {{fecha_limite}} (RN-06).`],
];

export function render(text, vars) {
  return text
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, inner) => (vars[k] ? inner : ''))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

export function plantillaVigente(codigo) {
  return q.get('SELECT * FROM plantillas WHERE codigo=? AND vigente=1 ORDER BY version DESC LIMIT 1', codigo);
}

export function nuevaVersionPlantilla(codigo, asunto, cuerpo, usuario) {
  const actual = plantillaVigente(codigo);
  const version = (actual?.version || 0) + 1;
  q.run('UPDATE plantillas SET vigente=0 WHERE codigo=?', codigo);
  q.run(`INSERT INTO plantillas(codigo, version, nombre, asunto, cuerpo, vigente, creado_por, creado_at)
         VALUES (?,?,?,?,?,1,?,?)`, codigo, version, actual?.nombre || codigo, asunto, cuerpo, usuario, nowIso());
  log({ usuario, entidad: 'plantilla', accion: `nueva versión ${codigo} v${version}`, antes: actual ? { version: actual.version } : null, despues: { asunto } });
  return version;
}

// Simulación de entrega: direcciones inexistentes "rebotan". Aquí se conecta el servicio real.
function deliver(destinatario) {
  if (!destinatario || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinatario) || /\.invalid$|rebote/i.test(destinatario)) return 'rebotado';
  return 'entregado';
}

/** Envía un aviso a partir de una plantilla y lo registra. */
export function send(codigo, { destinatario, vars, postulacion_id = null, empleador_id = null, oferta_id = null, usuario_id = null, interno = false }) {
  const p = plantillaVigente(codigo);
  if (!p) throw new Error(`Plantilla ${codigo} no existe`);
  const all = { contacto: CONTACTO, ...vars };
  const asunto = render(p.asunto, all);
  const cuerpo = render(p.cuerpo, all);
  const estado = interno ? 'interno' : deliver(destinatario);
  const r = q.run(`INSERT INTO avisos(tipo, postulacion_id, empleador_id, oferta_id, usuario_id, destinatario, plantilla_version, asunto, cuerpo, enviado_at, estado_entrega)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, codigo, postulacion_id, empleador_id, oferta_id, usuario_id, destinatario || '(sin correo)', p.version, asunto, cuerpo, nowIso(), estado);
  log({ entidad: 'aviso', entidad_id: Number(r.lastInsertRowid), oferta_id, accion: `aviso ${codigo} ${estado}`, despues: { destinatario: interno ? destinatario : '***', plantilla: `${codigo} v${p.version}` } });
  return { id: Number(r.lastInsertRowid), estado };
}
