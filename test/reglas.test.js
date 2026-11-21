// Pruebas de reglas y temporizadores con reloj simulado (9.7): RN-01..RN-19, P4 y bitácora.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, q } from '../lib/db.js';
import { setOffsetDays, today, addDays, businessDaysBetween, isBusinessDay, addBusinessDays } from '../lib/clock.js';
import { seedBase, rutCon } from '../lib/seed.js';
import * as E from '../lib/engine.js';
import { verifyChain } from '../lib/audit.js';
import { informeTrimestral, sup } from '../lib/reports.js';

let ej, jefa, emp, muni, n = 0;
const persona = () => ({ rut: rutCon(15000000 + (++n) * 7919), nombre: `Persona ${n}`, correo: `p${n}@correo.cl` });
const avanzar = (dias) => { setOffsetDays(Number(q.get(`SELECT valor FROM ajustes WHERE clave='reloj_desfase_dias'`)?.valor || 0) + dias); return E.tick(); };
const avisos = (oferta_id, tipo) => q.get('SELECT COUNT(*) c FROM avisos WHERE oferta_id=? AND tipo=?', oferta_id, tipo).c;
const nuevaOferta = (extra = {}) => {
  const id = E.crearOferta({ empleador_id: emp, cargo: 'Bodeguero/a', ejecutivo_id: ej.id, requisitos: [
    { descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' },
    { descripcion: 'Licencia clase B', tipo: 'excluyente', categoria: 'licencia' },
    { descripcion: 'Inglés', tipo: 'deseable', categoria: 'otro' }], ...extra });
  return id;
};
const evalTodo = (oferta_id, resultado) => Object.fromEntries(q.all('SELECT id, tipo, categoria FROM requisitos WHERE oferta_id=?', oferta_id)
  .map((r) => [r.id, { resultado: typeof resultado === 'function' ? resultado(r) : resultado, motivo: 'documento_faltante' }]));

before(() => {
  openDb(':memory:');
  setOffsetDays(0);
  seedBase();
  ej = q.get(`SELECT * FROM usuarios WHERE rol='ejecutivo' LIMIT 1`);
  jefa = q.get(`SELECT * FROM usuarios WHERE rol='jefatura'`);
  emp = E.registrarEmpleador({ rut: rutCon(76000001), razon_social: 'Empresa Prueba', tipo: 'privado', contacto_correo: 'rrhh@prueba.cl', acepta_condicion: true });
  muni = E.registrarEmpleador({ sigla: 'DOM', razon_social: 'Dirección de Obras', tipo: 'municipal', contacto_correo: 'dom@muni.cl', acepta_condicion: true });
});

test('RUT: validación de dígito verificador', () => {
  assert.ok(E.rutValido('11.111.111-1'));
  assert.ok(!E.rutValido('11.111.111-2'));
  assert.equal(E.normRut('12.345.678-k'), '12345678-K');
});

test('RN-15: días hábiles excluyen fines de semana y feriados', () => {
  assert.equal(isBusinessDay('2026-12-25'), false);      // Navidad, viernes
  assert.equal(isBusinessDay('2026-12-26'), false);      // sábado
  assert.equal(isBusinessDay('2026-12-28'), true);
  assert.equal(addBusinessDays('2026-12-24', 1), '2026-12-28');
  assert.equal(businessDaysBetween('2026-12-24', '2026-12-31'), 4);
});

test('P1: publicación con plazo por defecto de 10 días hábiles y E1', () => {
  const id = nuevaOferta();
  E.publicarOferta(id, {}, ej);
  const o = E.getOferta(id);
  assert.equal(o.estado, 'publicada');
  assert.equal(o.fecha_cierre_postulacion, addBusinessDays(today(), 10));
  assert.equal(o.fecha_derivacion, addBusinessDays(o.fecha_cierre_postulacion, 1));
  assert.equal(avisos(id, 'E1'), 1);
});

test('P1.3: requisitos discriminatorios bloquean la publicación', () => {
  const id = nuevaOferta({ requisitos: [{ descripcion: 'Mujer menor de 30 años', tipo: 'excluyente', categoria: 'otro' }] });
  assert.throws(() => E.publicarOferta(id, {}, ej), /discriminatorio/);
  E.observarOferta(id, 'Quite el requisito de sexo y edad', ej);
  assert.equal(E.getOferta(id).estado, 'observada');
  E.nuevaVersionOferta(id, { requisitos: [{ descripcion: 'Experiencia en ventas', tipo: 'excluyente', categoria: 'experiencia' }] }, ej);
  assert.equal(E.getOferta(id).estado, 'en_validacion');
  E.publicarOferta(id, {}, ej);
  assert.equal(E.getOferta(id).estado, 'publicada');
});

test('Consentimiento obligatorio, RN-16 duplicados y Aviso 1 (RN-04)', () => {
  const id = nuevaOferta(); E.publicarOferta(id, {}, ej);
  const p = persona();
  assert.throws(() => E.postular({ oferta_id: id, ...p }), /consentimiento/);
  E.postular({ oferta_id: id, ...p, consentimiento_postular: true });
  assert.throws(() => E.postular({ oferta_id: id, ...p, consentimiento_postular: true }), (e) => e.regla === 'RN-16');
  assert.equal(avisos(id, 'A1'), 1);
});

test('RN-01 y RN-03: clasificación calculada; corrección exige justificación', () => {
  const id = nuevaOferta(); E.publicarOferta(id, {}, ej);
  const { postulacion_id: a } = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true });
  const { postulacion_id: b } = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true });
  // deseable no acredita, excluyentes sí -> cumple
  E.clasificar(a, evalTodo(id, (r) => (r.tipo === 'excluyente' ? 'acredita' : 'no_acredita')), {}, ej);
  assert.equal(q.get('SELECT clasif_final FROM postulaciones WHERE id=?', a).clasif_final, 'cumple');
  // un excluyente no informado -> no cumple
  E.clasificar(b, evalTodo(id, (r) => (r.categoria === 'licencia' ? 'no_informado' : 'acredita')), {}, ej);
  assert.equal(q.get('SELECT clasif_final FROM postulaciones WHERE id=?', b).clasif_final, 'no_cumple');
  assert.throws(() => E.clasificar(b, {}, { clasif_final: 'cumple' }, ej), (e) => e.regla === 'RN-03');
  E.clasificar(b, {}, { clasif_final: 'cumple', justificacion: 'Presentó la licencia en persona' }, ej);
  const pb = q.get('SELECT * FROM postulaciones WHERE id=?', b);
  assert.equal(pb.clasif_calculada, 'no_cumple');
  assert.equal(pb.clasif_final, 'cumple');
});

test('Ciclo completo: derivación (RN-02, RN-05), recordatorios (RN-08) y cierre a 30 días (RN-07, A4, E4, RN-09)', () => {
  setOffsetDays(0);
  const id = nuevaOferta(); E.publicarOferta(id, {}, ej);
  const ps = [1, 2, 3].map(() => E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true }).postulacion_id);
  E.clasificar(ps[0], evalTodo(id, 'acredita'), {}, ej);
  // ps[1] y ps[2] quedan sin clasificar: igual se derivan
  const o = E.getOferta(id);
  const dias = Math.round((new Date(o.fecha_derivacion) - new Date(today())) / 86400000);
  avanzar(dias);
  const o2 = E.getOferta(id);
  assert.equal(o2.estado, 'derivada');
  assert.equal(JSON.parse(E.derivacionDe(id).nomina_json).length, 3, 'toda postulación se deriva');
  assert.equal(avisos(id, 'A2'), 3);
  assert.equal(avisos(id, 'E2'), 1);
  avanzar(10); assert.equal(avisos(id, 'E3'), 1);
  avanzar(10); assert.equal(avisos(id, 'E3'), 2);
  avanzar(9); assert.equal(E.getOferta(id).estado, 'derivada');
  avanzar(1);
  assert.equal(E.getOferta(id).estado, 'cerrada_sin_respuesta');
  assert.equal(avisos(id, 'A4'), 3);
  assert.equal(avisos(id, 'E4'), 1);
  assert.equal(q.get('SELECT COUNT(*) c FROM postulaciones WHERE oferta_id=? AND estado=?', id, 'cerrada_sin_resultado').c, 3);
  // RN-09: nueva oferta del mismo empleador requiere autorización
  const nueva = nuevaOferta();
  assert.equal(E.getOferta(nueva).requiere_autorizacion, 1);
  assert.throws(() => E.publicarOferta(nueva, {}, ej), (e) => e.regla === 'RN-09');
  E.autorizarOferta(nueva, jefa);
  E.publicarOferta(nueva, {}, ej);
  // RN-14: solo la jefatura reabre
  assert.throws(() => E.reabrirOferta(id, 'x', ej), (e) => e.regla === 'RN-14');
  E.reabrirOferta(id, 'El empleador respondió tarde por teléfono', jefa);
  assert.equal(E.getOferta(id).estado, 'derivada');
});

test('Resultado del empleador: seleccionados sin aviso, A3 a los demás (RN-06) y respeto de RN-18', () => {
  setOffsetDays(0);
  const emp2 = E.registrarEmpleador({ rut: rutCon(76000002), razon_social: 'Otra', tipo: 'privado', contacto_correo: 'x@otra.cl', acepta_condicion: true });
  const id = nuevaOferta({ empleador_id: emp2 }); E.publicarOferta(id, {}, ej);
  const a = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true, consentimiento_banco: true }).postulacion_id;
  const b = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true, consentimiento_banco: true }).postulacion_id;
  const c = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true }).postulacion_id;
  const tk = E.derivar(id);
  assert.throws(() => E.informarResultado(tk, { tipo: 'contratacion', contratados: [] }), /contrató/);
  E.informarResultado(tk, { tipo: 'contratacion', contratados: [a] });
  avanzar(12); // con resultado informado no corre el cierre automático
  assert.equal(E.getOferta(id).estado, 'derivada');
  assert.ok(q.get(`SELECT 1 FROM avisos WHERE oferta_id=? AND tipo='I2'`, id), 'alerta I2 por Aviso 3 por vencer');
  E.validarResultado(id, ej);
  assert.equal(E.getOferta(id).estado, 'cerrada_con_resultado');
  assert.equal(q.get('SELECT estado FROM postulaciones WHERE id=?', a).estado, 'seleccionada');
  assert.equal(q.get(`SELECT COUNT(*) c FROM avisos WHERE postulacion_id=? AND tipo='A3'`, a).c, 0, 'el seleccionado no recibe aviso masivo');
  const cuerpoB = q.get(`SELECT cuerpo FROM avisos WHERE postulacion_id=? AND tipo='A3'`, b).cuerpo;
  const cuerpoC = q.get(`SELECT cuerpo FROM avisos WHERE postulacion_id=? AND tipo='A3'`, c).cuerpo;
  assert.match(cuerpoB, /siguen registrados/);
  assert.doesNotMatch(cuerpoC, /siguen registrados/, 'RN-18: sin consentimiento no se ofrece el banco');
});

test('P4: oferta municipal — declaración (RN-10), abstención (RN-11), acta (RN-12) y marca de Control (RN-13)', () => {
  setOffsetDays(0);
  assert.throws(() => E.crearOferta({ empleador_id: muni, cargo: 'Auxiliar', requisitos: [{ descripcion: 'Media completa', tipo: 'excluyente' }] }), /entrevista/);
  const id = E.crearOferta({ empleador_id: muni, cargo: 'Auxiliar', ejecutivo_id: ej.id, requisitos: [{ descripcion: 'Media completa', tipo: 'excluyente', categoria: 'formacion' }],
    entrevistadores: [{ nombre: 'Ana' }, { nombre: 'Beto' }] });
  E.publicarOferta(id, {}, ej);
  const a = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true }).postulacion_id;
  const b = E.postular({ oferta_id: id, ...persona(), consentimiento_postular: true }).postulacion_id;
  // RN-10: el ejecutivo no clasifica sin declarar
  assert.throws(() => E.clasificar(a, evalTodo(id, 'acredita'), {}, ej), (e) => e.regla === 'RN-10');
  E.declarar(id, { tipo: 'usuario', id: ej.id, nombre: ej.nombre, declara_vinculo: false, firma: ej.nombre }, ej);
  E.clasificar(a, evalTodo(id, 'acredita'), {}, ej);
  E.clasificar(b, evalTodo(id, 'no_acredita'), {}, ej);
  const tk = E.derivar(id);
  const [ana, beto] = q.all('SELECT * FROM entrevistadores WHERE oferta_id=?', id);
  assert.throws(() => E.informarResultado(tk, { tipo: 'contratacion', contratados: [a] }), (e) => e.regla === 'RN-10');
  E.declarar(id, { tipo: 'entrevistador', id: ana.id, nombre: 'Ana', declara_vinculo: false, firma: 'Ana' });
  E.declarar(id, { tipo: 'entrevistador', id: beto.id, nombre: 'Beto', declara_vinculo: true, postulacion_relacionada_id: b, firma: 'Beto' });
  assert.equal(E.estadoDeclaracionesEntrevistadores(id).completo, false, 'RN-11: quien declara vínculo bloquea hasta su reemplazo');
  E.reemplazarEntrevistador(id, beto.id, { nombre: 'Carla' }, jefa);
  const carla = q.get('SELECT * FROM entrevistadores WHERE oferta_id=? AND activo=1 AND nombre=?', id, 'Carla');
  E.declarar(id, { tipo: 'entrevistador', id: carla.id, nombre: 'Carla', declara_vinculo: false, firma: 'Carla' });
  assert.equal(E.estadoDeclaracionesEntrevistadores(id).completo, true);
  assert.equal(q.get('SELECT abstencion FROM declaraciones WHERE oferta_id=? AND nombre=?', id, 'Beto').abstencion, 1);
  // RN-12: sin acta no se acepta
  assert.throws(() => E.informarResultado(tk, { tipo: 'contratacion', contratados: [b] }), (e) => e.regla === 'RN-12');
  const acta = { entrevistados: [a, b], criterio: 'Entrevista', firmantes: 'Ana; Carla' };
  // RN-13: seleccionar "no cumple" exige justificación
  assert.throws(() => E.informarResultado(tk, { tipo: 'contratacion', contratados: [b], acta }), (e) => e.regla === 'RN-13');
  E.informarResultado(tk, { tipo: 'contratacion', contratados: [b], acta: { ...acta, justificacion_no_cumple: 'Mejor prueba práctica' } });
  assert.equal(E.getOferta(id).marcada_control, 1);
  E.validarResultado(id, ej);
  assert.equal(E.getOferta(id).estado, 'cerrada_con_resultado');
});

test('P5: muestra reproducible con la semilla e incluye casos marcados', () => {
  const sem = `${today().slice(0, 4)}-S${Number(today().slice(5, 7)) <= 6 ? 1 : 2}`;
  const m1 = E.seleccionarMuestra(sem, 'abc');
  const m2 = E.seleccionarMuestra(sem, 'abc');
  assert.deepEqual(m1.elegidas, m2.elegidas);
  const marcada = q.get('SELECT id FROM ofertas WHERE marcada_control=1');
  if (marcada && m1.poblacion) assert.ok(m1.elegidas.includes(marcada.id));
});

test('RN-17: supresión de celdas menores a 5 en reportes', () => {
  assert.equal(sup(3), 'menos de 5');
  assert.equal(sup(0), 0);
  assert.equal(sup(7), 7);
  const r = informeTrimestral(`${today().slice(0, 4)}-T${Math.floor((Number(today().slice(5, 7)) - 1) / 3) + 1}`);
  assert.ok(!JSON.stringify(r).includes('correo.cl'), 'el informe no contiene datos personales');
});

test('RN-19: anonimización tras el plazo de conservación, salvo consentimiento banco', () => {
  const antes = q.get('SELECT COUNT(*) c FROM personas WHERE anonimizada=1').c;
  avanzar(E.PARAM.mesesConservacion * 30 + 40);
  const conBanco = q.get(`SELECT p.* FROM personas p JOIN consentimientos c ON c.persona_id=p.id WHERE c.tipo='banco_futuras' AND c.estado='vigente' LIMIT 1`);
  assert.ok(q.get('SELECT COUNT(*) c FROM personas WHERE anonimizada=1').c > antes);
  assert.equal(conBanco.anonimizada, 0);
});

test('Bitácora inalterable y encadenada', () => {
  assert.throws(() => q.run(`UPDATE bitacora SET accion='x' WHERE id=1`), /inalterable/);
  assert.throws(() => q.run('DELETE FROM bitacora WHERE id=1'), /inalterable/);
  assert.equal(verifyChain().ok, true);
});
