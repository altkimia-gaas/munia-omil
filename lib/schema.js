// Esquema de datos (sección 8.1), compartido por el servidor y la demo web.
export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE,
  rol TEXT NOT NULL CHECK (rol IN ('ejecutivo','jefatura','control','admin','dpo','dideco')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_at TEXT NOT NULL,
  clave_hash TEXT,                       -- scrypt
  totp_secreto TEXT,                     -- doble factor (app autenticadora)
  totp_activo INTEGER NOT NULL DEFAULT 0,
  totp_ultimo_paso INTEGER,              -- evita reutilizar un mismo código
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT,
  activacion_hash TEXT,                  -- enlace de activación o restablecimiento (solo el hash)
  activacion_vence TEXT,
  ultimo_acceso TEXT
);

CREATE TABLE IF NOT EXISTS sesiones (
  id TEXT PRIMARY KEY,                   -- SHA-256 del token de la cookie
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_at TEXT NOT NULL,
  expira_at TEXT NOT NULL,
  mfa_ok INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  agente TEXT
);

-- Enlaces y códigos que viajan por correo: se guardan aparte y se borran al enviarse.
CREATE TABLE IF NOT EXISTS secretos_envio (
  aviso_id INTEGER PRIMARY KEY REFERENCES avisos(id),
  valor TEXT NOT NULL,
  expira_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS firmas_codigo (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  entrevistador_id INTEGER NOT NULL,
  codigo_hash TEXT NOT NULL,
  expira_at TEXT NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  usado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conciliaciones_bne (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  archivo TEXT,
  resumen_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS talleres (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  lugar TEXT,
  cupos INTEGER,
  foco TEXT,                             -- motivo de no cumplimiento que aborda
  creado_por INTEGER REFERENCES usuarios(id),
  creado_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitaciones_taller (
  taller_id INTEGER NOT NULL REFERENCES talleres(id),
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  aviso_id INTEGER REFERENCES avisos(id),
  fecha TEXT NOT NULL,
  PRIMARY KEY (taller_id, persona_id)
);
CREATE TABLE IF NOT EXISTS derivaciones_capacitacion (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  curso TEXT NOT NULL,
  organismo TEXT,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'derivada' CHECK (estado IN ('derivada','inscrita','finalizada','desistida')),
  registrado_por INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS feriados (fecha TEXT PRIMARY KEY, nombre TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY,
  rut TEXT UNIQUE,
  nombre TEXT NOT NULL,
  correo TEXT,
  telefono TEXT,
  comuna TEXT,
  grupo_prioritario TEXT,            -- dato sensible: solo para el indicador SENCE
  codigo_seguimiento TEXT NOT NULL,
  anonimizada INTEGER NOT NULL DEFAULT 0,
  creado_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consentimientos (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('postular','banco_futuras','comunicaciones')),
  version_texto TEXT NOT NULL,
  otorgado_at TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('vigente','revocado')),
  revocado_at TEXT
);

CREATE TABLE IF NOT EXISTS empleadores (
  id INTEGER PRIMARY KEY,
  rut TEXT NOT NULL UNIQUE,
  razon_social TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('privado','municipal')),
  contacto_nombre TEXT,
  contacto_correo TEXT NOT NULL,
  telefono TEXT,
  acepta_condicion INTEGER NOT NULL DEFAULT 0,
  acepta_at TEXT,
  estado_cumplimiento TEXT NOT NULL DEFAULT 'al_dia',
  creado_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ofertas (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  empleador_id INTEGER NOT NULL REFERENCES empleadores(id),
  cargo TEXT NOT NULL,
  area TEXT,
  funciones TEXT,
  vacantes INTEGER NOT NULL DEFAULT 1,
  condiciones TEXT,
  jornada TEXT,
  renta TEXT,
  comuna TEXT,
  municipal INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL CHECK (estado IN ('en_validacion','observada','publicada','derivada',
      'cerrada_con_resultado','cerrada_sin_respuesta','desierta_anulada')),
  ejecutivo_id INTEGER REFERENCES usuarios(id),
  observacion TEXT,
  requiere_autorizacion INTEGER NOT NULL DEFAULT 0,
  autorizada_por INTEGER REFERENCES usuarios(id),
  publicada_at TEXT,
  fecha_cierre_postulacion TEXT,
  fecha_derivacion TEXT,
  derivada_at TEXT,
  cerrada_at TEXT,
  recordatorio10 INTEGER NOT NULL DEFAULT 0,
  recordatorio20 INTEGER NOT NULL DEFAULT 0,
  alerta_i1 INTEGER NOT NULL DEFAULT 0,
  marcada_control INTEGER NOT NULL DEFAULT 0,
  motivo_marca TEXT,
  congelada INTEGER NOT NULL DEFAULT 0,
  caso_oirs TEXT,
  registrada_bne INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  creado_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requisitos (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  descripcion TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('excluyente','deseable')),
  categoria TEXT NOT NULL CHECK (categoria IN ('formacion','experiencia','licencia','certificacion','otro'))
);

CREATE TABLE IF NOT EXISTS entrevistadores (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  nombre TEXT NOT NULL,
  correo TEXT,
  reemplaza_a INTEGER REFERENCES entrevistadores(id),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS postulaciones (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  canal TEXT NOT NULL CHECK (canal IN ('portal','presencial','correo')),
  creado_at TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('recibida','clasificada','derivada','seleccionada',
      'no_seleccionada','cerrada_sin_resultado','retirada')),
  clasif_calculada TEXT CHECK (clasif_calculada IN ('cumple','no_cumple')),
  clasif_final TEXT CHECK (clasif_final IN ('cumple','no_cumple')),
  justificacion_cambio TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  UNIQUE (persona_id, oferta_id)                      -- RN-16
);

CREATE TABLE IF NOT EXISTS evaluaciones (
  id INTEGER PRIMARY KEY,
  postulacion_id INTEGER NOT NULL REFERENCES postulaciones(id),
  requisito_id INTEGER NOT NULL REFERENCES requisitos(id),
  resultado TEXT NOT NULL CHECK (resultado IN ('acredita','no_acredita','no_informado')),
  motivo TEXT,
  UNIQUE (postulacion_id, requisito_id)
);

CREATE TABLE IF NOT EXISTS derivaciones (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL UNIQUE REFERENCES ofertas(id),
  fecha TEXT NOT NULL,
  huella TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  vence TEXT NOT NULL,
  n_postulantes INTEGER NOT NULL,
  nomina_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resultados (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  vigente INTEGER NOT NULL DEFAULT 1,               -- 0 si una reapertura (RN-14) lo dejó sin efecto
  fecha_informe TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('empleador','cierre_automatico')),
  tipo TEXT NOT NULL CHECK (tipo IN ('contratacion','desierta','anulada','sin_respuesta')),
  contratados_json TEXT NOT NULL DEFAULT '[]',
  comentario TEXT,
  validado_at TEXT,
  validado_por INTEGER REFERENCES usuarios(id),
  alerta_i2 INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS declaraciones (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  declarante_tipo TEXT NOT NULL CHECK (declarante_tipo IN ('usuario','entrevistador')),
  declarante_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  declara_vinculo INTEGER NOT NULL,
  postulacion_relacionada_id INTEGER REFERENCES postulaciones(id),  -- acceso restringido
  detalle TEXT,
  abstencion INTEGER NOT NULL DEFAULT 0,
  firma TEXT NOT NULL,
  verificacion TEXT,                     -- cómo se acreditó la identidad de quien firma
  sello TEXT,                            -- SHA-256 del contenido firmado
  UNIQUE (oferta_id, declarante_tipo, declarante_id)
);

CREATE TABLE IF NOT EXISTS actas (
  id INTEGER PRIMARY KEY,
  oferta_id INTEGER NOT NULL UNIQUE REFERENCES ofertas(id),
  entrevistados_json TEXT NOT NULL,
  criterio TEXT NOT NULL,
  seleccionados_json TEXT NOT NULL,
  firmantes TEXT NOT NULL,
  documento TEXT,
  justificacion_no_cumple TEXT,
  creado_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plantillas (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL,
  version INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  vigente INTEGER NOT NULL DEFAULT 1,
  creado_por TEXT,
  creado_at TEXT NOT NULL,
  UNIQUE (codigo, version)
);

CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  postulacion_id INTEGER REFERENCES postulaciones(id),
  empleador_id INTEGER REFERENCES empleadores(id),
  oferta_id INTEGER REFERENCES ofertas(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  destinatario TEXT NOT NULL,
  plantilla_version INTEGER,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  enviado_at TEXT NOT NULL,                 -- momento en que se generó el aviso (cola)
  estado_entrega TEXT NOT NULL CHECK (estado_entrega IN ('pendiente','entregado','rebotado','error','retenido','interno')),
  intentos INTEGER NOT NULL DEFAULT 0,
  proximo_intento TEXT,
  ultimo_error TEXT,
  id_proveedor TEXT,                        -- Message-ID o id del servicio de correo
  entregado_at TEXT,                        -- momento en que el servidor de correo lo aceptó
  redirigido_a TEXT                         -- fuera de producción: buzón de prueba que lo recibió
);

CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  usuario TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INTEGER,
  oferta_id INTEGER,
  accion TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  huella_prev TEXT NOT NULL,
  huella TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS bitacora_sin_update BEFORE UPDATE ON bitacora
BEGIN SELECT RAISE(ABORT, 'La bitácora es inalterable'); END;
CREATE TRIGGER IF NOT EXISTS bitacora_sin_delete BEFORE DELETE ON bitacora
BEGIN SELECT RAISE(ABORT, 'La bitácora es inalterable'); END;

CREATE TABLE IF NOT EXISTS muestras (
  id INTEGER PRIMARY KEY,
  semestre TEXT NOT NULL,
  semilla TEXT NOT NULL,
  ofertas_json TEXT NOT NULL,
  creado_por INTEGER REFERENCES usuarios(id),
  creado_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hallazgos (
  id INTEGER PRIMARY KEY,
  muestra_id INTEGER NOT NULL REFERENCES muestras(id),
  oferta_id INTEGER NOT NULL REFERENCES ofertas(id),
  descripcion TEXT NOT NULL,
  gravedad TEXT NOT NULL CHECK (gravedad IN ('leve','moderado','grave')),
  registrado_por INTEGER REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  plan_accion TEXT,
  respondido_por INTEGER REFERENCES usuarios(id),
  respondido_at TEXT
);

CREATE TABLE IF NOT EXISTS solicitudes_titular (
  id INTEGER PRIMARY KEY,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('acceso','rectificacion','supresion','oposicion','portabilidad','bloqueo')),
  detalle TEXT,
  fecha TEXT NOT NULL,
  plazo TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','resuelta','rechazada')),
  respuesta TEXT,
  resuelto_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_post_oferta ON postulaciones(oferta_id);
CREATE INDEX IF NOT EXISTS ix_post_persona ON postulaciones(persona_id);
CREATE INDEX IF NOT EXISTS ix_avisos_oferta ON avisos(oferta_id);
CREATE INDEX IF NOT EXISTS ix_avisos_cola ON avisos(estado_entrega, proximo_intento);
CREATE INDEX IF NOT EXISTS ix_bitacora_oferta ON bitacora(oferta_id);
`;
