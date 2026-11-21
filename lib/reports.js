// Reportería (M10): informe trimestral al Concejo (7.5), panel diario e indicadores (11.2).
// RN-17: sin datos personales; las celdas con menos de 5 personas se muestran como "menos de 5".
import { q } from './db.js';
import { today, toDate, businessDaysBetween, calendarDaysBetween, addDays, addBusinessDays } from './clock.js';
import { PARAM, MOTIVOS_NO_CUMPLE, ESTADO_OFERTA, resultadoVigente } from './engine.js';

export const sup = (n) => (n > 0 && n < PARAM.umbralSupresion ? 'menos de 5' : n);
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

export function rangoTrimestre(t) {
  const [y, qn] = t.split('-T').map(Number);
  const m0 = (qn - 1) * 3 + 1;
  const fin = new Date(y, m0 + 2, 0).getDate();
  return [`${y}-${String(m0).padStart(2, '0')}-01`, `${y}-${String(m0 + 2).padStart(2, '0')}-${fin}`];
}
export function trimestreActual() {
  const d = today();
  return `${d.slice(0, 4)}-T${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
}

export function informeTrimestral(t) {
  const [desde, hasta] = rangoTrimestre(t);
  const ofertas = q.all(`SELECT o.*, (SELECT COUNT(*) FROM postulaciones p WHERE p.oferta_id=o.id) n_post FROM ofertas o
    WHERE substr(o.creado_at,1,10) <= ? AND (o.cerrada_at IS NULL OR substr(o.cerrada_at,1,10) >= ?)`, hasta, desde);
  const porEstado = Object.entries(ESTADO_OFERTA).map(([k, v]) => [v, ofertas.filter((o) => o.estado === k).length]);
  const areas = {};
  for (const o of ofertas) { const a = o.area || 'Sin área'; areas[a] ??= { ofertas: 0, vacantes: 0 }; areas[a].ofertas++; areas[a].vacantes += o.vacantes; }

  const posts = q.all(`SELECT p.* FROM postulaciones p WHERE substr(p.creado_at,1,10) BETWEEN ? AND ?`, desde, hasta);
  const clasif = posts.filter((p) => p.clasif_final);
  const cumple = clasif.filter((p) => p.clasif_final === 'cumple').length;
  const motivos = q.all(`SELECT e.motivo, COUNT(DISTINCT e.postulacion_id) n FROM evaluaciones e JOIN postulaciones p ON p.id=e.postulacion_id
    WHERE e.resultado!='acredita' AND e.motivo IS NOT NULL AND substr(p.creado_at,1,10) BETWEEN ? AND ? GROUP BY e.motivo ORDER BY n DESC`, desde, hasta)
    .map((m) => [MOTIVOS_NO_CUMPLE[m.motivo] || m.motivo, sup(m.n)]);

  const cerradas = q.all(`SELECT * FROM ofertas WHERE estado IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada') AND substr(cerrada_at,1,10) BETWEEN ? AND ?`, desde, hasta);
  const conResultado = cerradas.filter((o) => o.estado !== 'cerrada_sin_respuesta').length;
  const sinResp = cerradas.filter((o) => o.estado === 'cerrada_sin_respuesta').length;
  const contratadas = new Set();
  for (const o of cerradas) {
    const r = resultadoVigente(o.id);
    if (r?.tipo === 'contratacion') for (const pid of JSON.parse(r.contratados_json)) contratadas.add(q.get('SELECT persona_id FROM postulaciones WHERE id=?', pid)?.persona_id);
  }
  const ponderadas = q.get(`SELECT valor FROM ajustes WHERE clave=?`, `colocaciones_sence_${t}`)?.valor;

  // Oportunidad del Aviso 3 (RN-06)
  let a3Total = 0, a3EnPlazo = 0;
  for (const o of cerradas.filter((x) => x.estado !== 'cerrada_sin_respuesta')) {
    const r = resultadoVigente(o.id);
    if (!r || r.origen !== 'empleador') continue;
    const tipos = r.tipo === 'contratacion' ? ['A3'] : ['A3D'];
    const avisos = q.all(`SELECT enviado_at FROM avisos WHERE oferta_id=? AND tipo IN (${tipos.map(() => '?').join(',')})`, o.id, ...tipos);
    for (const a of avisos) {
      a3Total++;
      if (businessDaysBetween(toDate(r.fecha_informe), toDate(a.enviado_at)) <= PARAM.diasHabilesAviso3) a3EnPlazo++;
    }
  }
  // Cobertura del aviso de cierre (11.2)
  const postsCerradas = q.all(`SELECT p.id, p.estado FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id
    WHERE o.estado IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada') AND substr(o.cerrada_at,1,10) BETWEEN ? AND ?
    AND p.estado NOT IN ('seleccionada','retirada')`, desde, hasta);
  const conAvisoCierre = postsCerradas.filter((p) => q.get(`SELECT 1 FROM avisos WHERE postulacion_id=? AND tipo IN ('A3','A3D','A4')`, p.id)).length;

  // Ofertas municipales
  const muni = cerradas.filter((o) => o.municipal);
  const muniCon = muni.filter((o) => o.estado === 'cerrada_con_resultado');
  const actas = muniCon.filter((o) => q.get('SELECT 1 FROM actas WHERE oferta_id=?', o.id)).length;
  const abst = q.get(`SELECT COUNT(*) c FROM declaraciones d JOIN ofertas o ON o.id=d.oferta_id WHERE d.abstencion=1 AND substr(d.fecha,1,10) BETWEEN ? AND ?`, desde, hasta).c;
  let selCumple = 0, selNoCumple = 0, contratMuni = 0;
  for (const o of muniCon) {
    const r = resultadoVigente(o.id);
    for (const pid of JSON.parse(r?.contratados_json || '[]')) {
      contratMuni++;
      const p = q.get('SELECT clasif_final FROM postulaciones WHERE id=?', pid);
      if (p?.clasif_final === 'cumple') selCumple++; else selNoCumple++;
    }
  }
  return {
    trimestre: t, desde, hasta,
    porEstado, areas: Object.entries(areas).map(([a, v]) => [a, v.ofertas, v.vacantes]),
    vacantes: ofertas.reduce((s, o) => s + o.vacantes, 0),
    postulaciones: posts.length, clasificadas: clasif.length, pctCumple: pct(cumple, clasif.length), motivos,
    personasContratadas: sup(contratadas.size), colocacionesPonderadas: ponderadas ?? 'no informado',
    cerradas: cerradas.length, pctConResultado: pct(conResultado, cerradas.length), pctSinRespuesta: pct(sinResp, cerradas.length),
    pctA3EnPlazo: pct(a3EnPlazo, a3Total), coberturaCierre: pct(conAvisoCierre, postsCerradas.length),
    municipal: { cerradas: muni.length, contrataciones: sup(contratMuni), actas: `${actas} de ${muniCon.length}`, abstenciones: sup(abst), selCumple: sup(selCumple), selNoCumple: sup(selNoCumple) },
  };
}

/** Panel de gestión OMIL (diario) — 7.5 */
export function panel(user) {
  const hoy = today();
  const filtroEj = user?.rol === 'ejecutivo' ? ` AND o.ejecutivo_id=${Number(user.id)}` : '';
  const porVencer = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id
    WHERE o.estado='publicada' AND o.fecha_cierre_postulacion <= ?${filtroEj} ORDER BY o.fecha_cierre_postulacion`, addBusinessDays(hoy, 3));
  const sinClasificar = q.all(`SELECT o.id, o.codigo, o.cargo, COUNT(p.id) n FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id
    WHERE p.estado='recibida' AND o.estado='publicada'${filtroEj} GROUP BY o.id ORDER BY o.fecha_derivacion`);
  const pendientes = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado='derivada'${filtroEj} ORDER BY o.derivada_at`)
    .map((o) => ({ ...o, dias: calendarDaysBetween(toDate(o.derivada_at), hoy), res: resultadoVigente(o.id) }));
  const enValidacion = q.all(`SELECT o.*, e.razon_social FROM ofertas o JOIN empleadores e ON e.id=o.empleador_id WHERE o.estado IN ('en_validacion','observada')${filtroEj} ORDER BY o.creado_at`);
  const rebotados = q.all(`SELECT a.*, o.codigo FROM avisos a LEFT JOIN ofertas o ON o.id=a.oferta_id WHERE a.estado_entrega IN ('rebotado','error','retenido')${filtroEj ? filtroEj.replace('o.ejecutivo_id', 'o.ejecutivo_id') : ''} ORDER BY a.id DESC LIMIT 20`);
  const carga = q.all(`SELECT u.id, u.nombre,
      SUM(o.estado IN ('en_validacion','observada')) val, SUM(o.estado='publicada') pub, SUM(o.estado='derivada') der,
      (SELECT COUNT(*) FROM postulaciones p JOIN ofertas o2 ON o2.id=p.oferta_id WHERE o2.ejecutivo_id=u.id AND p.estado='recibida') sin_clasif
    FROM usuarios u LEFT JOIN ofertas o ON o.ejecutivo_id=u.id WHERE u.rol='ejecutivo' AND u.activo=1 GROUP BY u.id ORDER BY u.nombre`);
  const alertas = q.all(`SELECT a.*, o.codigo FROM avisos a LEFT JOIN ofertas o ON o.id=a.oferta_id WHERE a.estado_entrega='interno' AND a.usuario_id=? ORDER BY a.id DESC LIMIT 10`, user?.id || 0);
  const abstenciones = q.all(`SELECT d.*, o.codigo, o.cargo, o.id oferta_id FROM declaraciones d JOIN ofertas o ON o.id=d.oferta_id
    WHERE d.declara_vinculo=1 AND o.estado NOT IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada')
    AND ((d.declarante_tipo='usuario' AND o.ejecutivo_id=d.declarante_id) OR (d.declarante_tipo='entrevistador' AND EXISTS (SELECT 1 FROM entrevistadores e WHERE e.id=d.declarante_id AND e.activo=1)))`);
  const solicitudes = q.all(`SELECT * FROM solicitudes_titular WHERE estado='pendiente' ORDER BY plazo`);
  return { porVencer, sinClasificar, pendientes, enValidacion, rebotados, carga, alertas, abstenciones, solicitudes };
}

/** Indicadores 11.2 (acumulados del período) */
export function indicadores(desde = '2000-01-01', hasta = '2999-12-31') {
  const cerradas = q.all(`SELECT * FROM ofertas WHERE estado IN ('cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada') AND substr(cerrada_at,1,10) BETWEEN ? AND ?`, desde, hasta);
  const postsCerr = q.all(`SELECT p.id FROM postulaciones p JOIN ofertas o ON o.id=p.oferta_id WHERE o.id IN (${cerradas.map((o) => o.id).join(',') || 0}) AND p.estado NOT IN ('seleccionada','retirada')`);
  const conAviso = postsCerr.filter((p) => q.get(`SELECT 1 FROM avisos WHERE postulacion_id=? AND tipo IN ('A3','A3D','A4')`, p.id)).length;
  const conRes = cerradas.filter((o) => o.estado !== 'cerrada_sin_respuesta').length;
  const ciclos = cerradas.filter((o) => o.derivada_at).map((o) => calendarDaysBetween(toDate(o.derivada_at), toDate(o.cerrada_at)));
  const enviados = q.get(`SELECT COUNT(*) c FROM avisos WHERE estado_entrega IN ('entregado','rebotado') AND substr(enviado_at,1,10) BETWEEN ? AND ?`, desde, hasta).c;
  const rebot = q.get(`SELECT COUNT(*) c FROM avisos WHERE estado_entrega='rebotado' AND substr(enviado_at,1,10) BETWEEN ? AND ?`, desde, hasta).c;
  const clas = q.all(`SELECT clasif_final FROM postulaciones WHERE clasif_final IS NOT NULL AND substr(creado_at,1,10) BETWEEN ? AND ?`, desde, hasta);
  const muniCon = cerradas.filter((o) => o.municipal && o.estado === 'cerrada_con_resultado');
  const actas = muniCon.filter((o) => q.get('SELECT 1 FROM actas WHERE oferta_id=?', o.id)).length;
  const ent = q.all(`SELECT e.id, e.oferta_id FROM entrevistadores e JOIN ofertas o ON o.id=e.oferta_id WHERE e.activo=1 AND o.estado IN ('derivada','cerrada_con_resultado','desierta_anulada')`);
  const entDecl = ent.filter((e) => q.get(`SELECT 1 FROM declaraciones WHERE oferta_id=? AND declarante_tipo='entrevistador' AND declarante_id=?`, e.oferta_id, e.id)).length;
  return [
    ['Cobertura del aviso de cierre', pct(conAviso, postsCerr.length), '100%'],
    ['Respuesta de empleadores', pct(conRes, cerradas.length), '70% o más'],
    ['Ciclo de la oferta (días desde derivación)', ciclos.length ? (ciclos.reduce((a, b) => a + b, 0) / ciclos.length).toFixed(1) : '—', '25 días o menos'],
    ['Actas en ofertas municipales', pct(actas, muniCon.length), '100%'],
    ['Declaraciones de vínculos', pct(entDecl, ent.length), '100%'],
    ['Calce de postulaciones (cumple)', pct(clas.filter((c) => c.clasif_final === 'cumple').length, clas.length), '55%'],
    ['Calidad del envío (rebotes)', pct(rebot, enviados), 'menos de 3%'],
  ];
}
