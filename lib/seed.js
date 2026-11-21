// Datos base (usuarios, feriados, plantillas) y escenario de demostración.
// El escenario se construye con el propio motor y el reloj simulado, así que bitácora,
// avisos y temporizadores quedan coherentes, como si el sistema hubiera operado ~75 días.
import { rmSync } from 'node:fs';
import { openDb, q, getDb } from './db.js';
import { setOffsetDays, nowIso, FERIADOS_BASE, invalidateFeriados } from './clock.js';
import { PLANTILLAS_BASE } from './notify.js';
import * as E from './engine.js';
import { log } from './audit.js';

export const USUARIOS = [
  ['Carolina Rojas', 'crojas@municipalidadcasablanca.cl', 'jefatura'],
  ['Pedro Soto', 'psoto@municipalidadcasablanca.cl', 'ejecutivo'],
  ['Valentina Muñoz', 'vmunoz@municipalidadcasablanca.cl', 'ejecutivo'],
  ['Jorge Díaz', 'jdiaz@municipalidadcasablanca.cl', 'control'],
  ['Andrea Fuentes', 'afuentes@municipalidadcasablanca.cl', 'admin'],
  ['Marcela Pérez', 'mperez@municipalidadcasablanca.cl', 'dpo'],
  ['Luis Herrera', 'lherrera@municipalidadcasablanca.cl', 'dideco'],
];

export function seedBase() {
  if (q.get('SELECT COUNT(*) c FROM usuarios').c === 0) {
    for (const [n, c, r] of USUARIOS) q.run('INSERT INTO usuarios(nombre, correo, rol, creado_at) VALUES (?,?,?,?)', n, c, r, nowIso());
  }
  for (const [f, n] of FERIADOS_BASE) q.run('INSERT OR IGNORE INTO feriados(fecha, nombre) VALUES (?,?)', f, n);
  invalidateFeriados();
  for (const [codigo, nombre, asunto, cuerpo] of PLANTILLAS_BASE) {
    if (!q.get('SELECT 1 FROM plantillas WHERE codigo=?', codigo)) {
      q.run('INSERT INTO plantillas(codigo, version, nombre, asunto, cuerpo, vigente, creado_por, creado_at) VALUES (?,?,?,?,?,1,?,?)', codigo, 1, nombre, asunto, cuerpo, 'carga inicial', nowIso());
    }
  }
}

export function rutCon(num) {
  let suma = 0, mul = 2;
  const s = String(num);
  for (let i = s.length - 1; i >= 0; i--) { suma += Number(s[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11);
  return `${num}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
}

const NOMBRES = ['Camila Araya', 'Matías González', 'Javiera Contreras', 'Benjamín Silva', 'Fernanda Reyes', 'Diego Morales',
  'Constanza Torres', 'Sebastián Castro', 'Catalina Vargas', 'Nicolás Rojas', 'Antonia Espinoza', 'Joaquín Sepúlveda',
  'Valentina Pizarro', 'Tomás Herrera', 'Isidora Núñez', 'Vicente Gutiérrez', 'Francisca Lagos', 'Cristóbal Vera',
  'Martina Tapia', 'Felipe Carrasco', 'Josefa Molina', 'Ignacio Cortés', 'Florencia Salazar', 'Agustín Figueroa',
  'Daniela Riquelme', 'Maximiliano Pino', 'Paula Bravo', 'Rodrigo Valenzuela', 'Rocío Fuentes', 'Gonzalo Orellana',
  'Macarena Soto', 'Andrés Miranda', 'Bárbara Jara', 'Cristian Cáceres', 'Natalia Henríquez', 'Héctor Álvarez'];

let rndState = 7;
const rnd = () => { rndState = (rndState * 16807) % 2147483647; return rndState / 2147483647; };

function persona(i) {
  const nombre = NOMBRES[i % NOMBRES.length];
  const slug = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/, '.').replace(/\s/g, '');
  return {
    rut: rutCon(12000000 + i * 104729), nombre,
    correo: i === 5 ? `${slug}@rebote.invalid` : `${slug}@correo.cl`,
    telefono: `+569${String(50000000 + i * 7919).slice(0, 8)}`, comuna: i % 4 === 0 ? 'Algarrobo' : 'Casablanca',
  };
}

export function seedDemo() {
  const U = Object.fromEntries(q.all('SELECT * FROM usuarios').map((u) => [u.correo.split('@')[0], u]));
  const pedro = U.psoto, vale = U.vmunoz, jefa = U.crojas;
  const at = (d) => { setOffsetDays(d); E.tick(); };
  let pi = 0;
  const postularN = (oferta_id, n, opts = {}) => {
    const ids = [];
    for (let k = 0; k < n; k++) {
      const p = persona(pi++);
      const canal = k % 5 === 4 ? 'presencial' : 'portal';
      const r = E.postular({ oferta_id, ...p, consentimiento_postular: true, consentimiento_banco: k % 3 !== 0, canal, ...opts }, canal === 'presencial' ? opts.ej : 'postulante');
      ids.push(r.postulacion_id);
    }
    return ids;
  };
  const motivoPara = { formacion: 'formacion_insuficiente', experiencia: 'experiencia_insuficiente', licencia: 'sin_licencia', certificacion: 'sin_certificacion', otro: 'documento_faltante' };
  const clasificarTodas = (ids, actor, prob = 0.55) => {
    for (const pid of ids) {
      const p = q.get('SELECT * FROM postulaciones WHERE id=?', pid);
      const evals = {};
      for (const r of q.all('SELECT * FROM requisitos WHERE oferta_id=?', p.oferta_id)) {
        const ok = rnd() < (r.tipo === 'excluyente' ? prob + 0.25 : 0.5);
        evals[r.id] = ok ? { resultado: 'acredita' } : { resultado: rnd() < 0.8 ? 'no_acredita' : 'no_informado', motivo: motivoPara[r.categoria] };
      }
      E.clasificar(pid, evals, {}, actor);
    }
  };

  // Empleadores
  const agricola = E.registrarEmpleador({ rut: rutCon(76543210), razon_social: 'Agrícola Valle de Casablanca SpA', tipo: 'privado', contacto_nombre: 'Rosa Valdés', contacto_correo: 'rrhh@agricolavalle.cl', telefono: '32 2741100', acepta_condicion: true });
  const vina = E.registrarEmpleador({ rut: rutCon(77123456), razon_social: 'Viña Lomas del Mar Ltda.', tipo: 'privado', contacto_nombre: 'Tomás Ibáñez', contacto_correo: 'personas@lomasdelmar.cl', acepta_condicion: true });
  const super_ = E.registrarEmpleador({ rut: rutCon(78900123), razon_social: 'Supermercado El Puerto S.A.', tipo: 'privado', contacto_nombre: 'Gabriela Leiva', contacto_correo: 'seleccion@elpuerto.cl', acepta_condicion: true });
  const dom = E.registrarEmpleador({ sigla: 'DOM', razon_social: 'Dirección de Obras Municipales', tipo: 'municipal', contacto_nombre: 'Arq. Mónica Saavedra', contacto_correo: 'dom@municipalidadcasablanca.cl', acepta_condicion: true });
  const constr = E.registrarEmpleador({ rut: rutCon(76111222), razon_social: 'Constructora Litoral Central Ltda.', tipo: 'privado', contacto_nombre: 'Raúl Mena', contacto_correo: 'obras@litoralcentral.cl', acepta_condicion: true });

  // O1 · cerrada con resultado
  at(-75);
  const o1 = E.crearOferta({ empleador_id: agricola, cargo: 'Operario/a de packing', area: 'Agroindustria', vacantes: 3, funciones: 'Selección, embalaje y etiquetado de fruta de exportación.', jornada: 'Completa, turnos', renta: '$560.000 bruto', condiciones: 'Contrato por temporada con opción de continuidad',
    ejecutivo_id: pedro.id, requisitos: [{ descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' }, { descripcion: 'Experiencia de 6 meses en packing o agroindustria', tipo: 'excluyente', categoria: 'experiencia' }, { descripcion: 'Disponibilidad para turnos rotativos', tipo: 'deseable', categoria: 'otro' }] }, 'empleador');
  E.publicarOferta(o1, {}, pedro);
  const p1 = postularN(o1, 9, { ej: pedro });
  at(-70);
  const o2 = E.crearOferta({ empleador_id: vina, cargo: 'Ayudante de bodega', area: 'Vitivinicultura', vacantes: 2, funciones: 'Apoyo en recepción de uva, limpieza de cubas y despacho.', jornada: 'Completa', renta: '$529.000 bruto',
    ejecutivo_id: vale.id, requisitos: [{ descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' }, { descripcion: 'Curso de manipulación de alimentos', tipo: 'deseable', categoria: 'certificacion' }] }, 'empleador');
  E.publicarOferta(o2, {}, vale);
  const p2 = postularN(o2, 6, { ej: vale });
  at(-66); clasificarTodas(p1, pedro); clasificarTodas(p2, vale);
  at(-58); // derivan O1 y O2
  at(-52);
  const t1 = E.derivacionDe(o1).token;
  const sel1 = p1.filter((pid) => q.get('SELECT clasif_final FROM postulaciones WHERE id=?', pid).clasif_final === 'cumple').slice(0, 2);
  E.informarResultado(t1, { tipo: 'contratacion', contratados: sel1.length ? sel1 : [p1[0]], comentario: 'Ingresan el lunes.' });
  at(-50); E.validarResultado(o1, pedro);

  // O3 · municipal con abstención, acta y selección "no cumple" (RN-13)
  at(-40);
  const o3 = E.crearOferta({ empleador_id: dom, cargo: 'Auxiliar de servicios (código del trabajo)', area: 'Municipal', vacantes: 1, funciones: 'Mantención menor de dependencias municipales y apoyo en terreno.', jornada: 'Completa', renta: '$610.000 bruto',
    ejecutivo_id: pedro.id, requisitos: [{ descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' }, { descripcion: 'Licencia de conducir clase B', tipo: 'excluyente', categoria: 'licencia' }, { descripcion: 'Experiencia en mantención', tipo: 'deseable', categoria: 'experiencia' }],
    entrevistadores: [{ nombre: 'Arq. Mónica Saavedra', correo: 'dom@municipalidadcasablanca.cl' }, { nombre: 'Ricardo Lillo', correo: 'rlillo@municipalidadcasablanca.cl' }] }, 'Dirección de Obras Municipales');
  E.publicarOferta(o3, {}, pedro);
  const p3 = postularN(o3, 7, { ej: pedro });
  at(-36);
  E.declarar(o3, { tipo: 'usuario', id: pedro.id, nombre: pedro.nombre, declara_vinculo: false, firma: pedro.nombre }, pedro);
  clasificarTodas(p3, pedro, 0.4);
  at(-30);
  const o4 = E.crearOferta({ empleador_id: super_, cargo: 'Reponedor/a', area: 'Comercio', vacantes: 2, funciones: 'Reposición de góndolas y control de vencimientos.', jornada: 'Part-time 30 h', renta: '$420.000 bruto',
    ejecutivo_id: vale.id, requisitos: [{ descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' }, { descripcion: 'Experiencia en retail', tipo: 'deseable', categoria: 'experiencia' }] }, 'empleador');
  E.publicarOferta(o4, {}, vale);
  const p4 = postularN(o4, 8, { ej: vale });
  at(-24); // deriva O3
  const ents = q.all('SELECT * FROM entrevistadores WHERE oferta_id=? AND activo=1', o3);
  E.declarar(o3, { tipo: 'entrevistador', id: ents[0].id, nombre: ents[0].nombre, declara_vinculo: false, firma: ents[0].nombre });
  E.declarar(o3, { tipo: 'entrevistador', id: ents[1].id, nombre: ents[1].nombre, declara_vinculo: true, postulacion_relacionada_id: p3[2], detalle: 'Primo', firma: ents[1].nombre });
  at(-23);
  E.reemplazarEntrevistador(o3, ents[1].id, { nombre: 'Claudia Bustos', correo: 'cbustos@municipalidadcasablanca.cl' }, jefa);
  const nuevo = q.get('SELECT * FROM entrevistadores WHERE oferta_id=? AND activo=1 AND reemplaza_a IS NOT NULL', o3);
  E.declarar(o3, { tipo: 'entrevistador', id: nuevo.id, nombre: nuevo.nombre, declara_vinculo: false, firma: nuevo.nombre });
  at(-20);
  clasificarTodas(p4.slice(0, 6), vale);
  const o5 = E.crearOferta({ empleador_id: agricola, cargo: 'Tractorista', area: 'Agroindustria', vacantes: 1, funciones: 'Operación de tractor en labores de huerto.', jornada: 'Completa', renta: '$700.000 bruto',
    ejecutivo_id: pedro.id, requisitos: [{ descripcion: 'Licencia de conducir clase D', tipo: 'excluyente', categoria: 'licencia' }, { descripcion: 'Experiencia de 1 año operando tractor', tipo: 'excluyente', categoria: 'experiencia' }] }, 'empleador');
  E.publicarOferta(o5, {}, pedro);
  const p5 = postularN(o5, 5, { ej: pedro });
  at(-18);
  const t3 = E.derivacionDe(o3).token;
  const nomina3 = JSON.parse(E.derivacionDe(o3).nomina_json);
  const noCumple = nomina3.find((n) => n.clasificacion === 'no_cumple' && n.postulacion_id !== p3[2]) || nomina3[0];
  E.informarResultado(t3, { tipo: 'contratacion', contratados: [noCumple.postulacion_id],
    acta: { entrevistados: nomina3.slice(0, 4).map((n) => n.postulacion_id), criterio: 'Entrevista estructurada de 4 preguntas y prueba práctica de mantención.', firmantes: 'Mónica Saavedra; Claudia Bustos',
      justificacion_no_cumple: 'La licencia clase B está en trámite con fecha de examen; mejor desempeño en la prueba práctica.' } }, 'Dirección de Obras Municipales');
  at(-15); E.validarResultado(o3, pedro);
  clasificarTodas(p5, pedro);
  at(-14); // deriva O4
  at(-8);
  const o6 = E.crearOferta({ empleador_id: super_, cargo: 'Cajero/a', area: 'Comercio', vacantes: 2, funciones: 'Atención de caja y cuadratura.', jornada: 'Completa', renta: '$540.000 bruto',
    ejecutivo_id: vale.id, requisitos: [{ descripcion: 'Enseñanza media completa', tipo: 'excluyente', categoria: 'formacion' }, { descripcion: 'Experiencia de 6 meses en atención de público', tipo: 'excluyente', categoria: 'experiencia' }] }, 'empleador');
  E.publicarOferta(o6, {}, vale);
  const p6 = postularN(o6, 5, { ej: vale });
  clasificarTodas(p6.slice(0, 2), vale);
  at(-6);
  const t4 = E.derivacionDe(o4).token;
  E.informarResultado(t4, { tipo: 'contratacion', contratados: [p4[1]], comentario: 'Seleccionamos una persona; la segunda vacante queda para más adelante.' });
  at(-5); // deriva O5
  at(-2);
  E.crearOferta({ empleador_id: vina, cargo: 'Guía de enoturismo', area: 'Turismo', vacantes: 1, funciones: 'Recorridos guiados y degustaciones.', jornada: 'Fines de semana', renta: '$380.000 bruto',
    requisitos: [{ descripcion: 'Inglés intermedio acreditable', tipo: 'excluyente', categoria: 'certificacion' }] }, 'empleador');
  E.crearOferta({ empleador_id: constr, cargo: 'Jornal de obra', area: 'Construcción', vacantes: 4, funciones: 'Apoyo en faenas de obra gruesa.', jornada: 'Completa', renta: '$600.000 bruto',
    requisitos: [{ descripcion: 'Hombre entre 25 y 40 años', tipo: 'excluyente', categoria: 'otro' }, { descripcion: 'Curso de prevención de riesgos', tipo: 'deseable', categoria: 'certificacion' }] }, 'empleador');
  // Solicitud de derechos y una postulación retirada
  E.solicitudTitular(q.get('SELECT persona_id FROM postulaciones WHERE id=?', p2[0]).persona_id, 'acceso', 'Solicito copia de los datos que la OMIL tiene registrados.');
  E.retirarPostulacion(q.get('SELECT persona_id FROM postulaciones WHERE id=?', p6[4]).persona_id, p6[4]);
  q.run(`INSERT OR REPLACE INTO ajustes(clave, valor) VALUES ('colocaciones_sence_2026-T3', '142')`);
  at(0);
  log({ usuario: 'sistema', entidad: 'sistema', accion: 'carga del escenario de demostración' });
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const file = process.env.TRAZA_DB || 'data/traza.db';
  if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  openDb(file);
  seedBase();
  if (!process.argv.includes('--sin-demo')) seedDemo();
  const c = (t) => q.get(`SELECT COUNT(*) c FROM ${t}`).c;
  console.log(`Base lista: ${c('ofertas')} ofertas, ${c('postulaciones')} postulaciones, ${c('avisos')} avisos, ${c('bitacora')} eventos de bitácora.`);
  getDb().close();
}
