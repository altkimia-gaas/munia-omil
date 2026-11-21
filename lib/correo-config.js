// Configuración del correo de avisos (M7). Se lee de variables de entorno (archivo .env, ver .env.ejemplo).
// Este módulo no abre conexiones: lo usan también la demo web y las pruebas.

const env = () => (typeof process !== 'undefined' && process.env) || {};

export const ESTADOS_AVISO = {
  pendiente: 'En cola', entregado: 'Enviado', rebotado: 'Rebotado', error: 'Error de envío', retenido: 'Retenido', interno: 'Interno',
};

/** Reintentos (minutos desde el intento anterior). Suman ~1 h: RN-04 exige el Aviso 1 dentro de la hora. */
export const ESPERAS_MIN = [1, 2, 5, 10, 20, 30];

export function correoConfig() {
  const e = env();
  const modo = ['smtp', 'resend'].includes(e.CORREO_MODO) ? e.CORREO_MODO : 'simulado';
  const puerto = Number(e.SMTP_PUERTO || 587);
  const remitente = e.CORREO_REMITENTE || 'OMIL Casablanca <omil@municipalidadcasablanca.cl>';
  return {
    modo,
    real: modo !== 'simulado',
    produccion: e.TRAZA_ENTORNO === 'produccion',
    remitente,
    remitenteDir: (/<([^>]+)>/.exec(remitente) || [null, remitente])[1].trim(),
    responderA: e.CORREO_RESPONDER_A || 'omilpersonas@municipalidadcasablanca.cl',
    redirigirA: (e.CORREO_REDIRIGIR_A || '').trim() || null,
    maxIntentos: Number(e.CORREO_MAX_INTENTOS || ESPERAS_MIN.length + 1),
    smtp: {
      host: e.SMTP_HOST || '',
      puerto,
      seguridad: e.SMTP_SEGURIDAD || (puerto === 465 ? 'tls' : 'starttls'), // tls | starttls | ninguna
      usuario: e.SMTP_USUARIO || '',
      clave: e.SMTP_CLAVE || '',
      helo: e.SMTP_HELO || 'traza-omil.local',
    },
    resendKey: e.RESEND_API_KEY || '',
  };
}

/** Resumen sin secretos para la pantalla de Administración. */
export function resumenCorreo() {
  const c = correoConfig();
  const problemas = [];
  if (c.modo === 'smtp' && !c.smtp.host) problemas.push('Falta SMTP_HOST');
  if (c.modo === 'smtp' && c.smtp.usuario && !c.smtp.clave) problemas.push('Falta SMTP_CLAVE');
  if (c.modo === 'resend' && !c.resendKey) problemas.push('Falta RESEND_API_KEY');
  if (c.real && !c.produccion && !c.redirigirA) problemas.push('Fuera de producción los avisos quedan retenidos: configure CORREO_REDIRIGIR_A (buzón de prueba)');
  return {
    modo: c.modo, entorno: c.produccion ? 'producción' : 'pruebas', remitente: c.remitente, responderA: c.responderA,
    destino: c.modo === 'smtp' ? `${c.smtp.host || '—'}:${c.smtp.puerto} (${c.smtp.seguridad}${c.smtp.usuario ? `, usuario ${c.smtp.usuario}` : ''})` : c.modo === 'resend' ? 'API de Resend' : 'Bandeja de salida interna (no se envía)',
    redirigirA: c.redirigirA, problemas,
  };
}

export const direccionValida = (d) => !!d && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(d);
