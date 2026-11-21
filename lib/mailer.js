// Despacho real de avisos (M7): cola con reintentos sobre SMTP o la API de Resend. Sin dependencias.
// Solo lo usa el servidor (abre conexiones de red); la demo web y las pruebas de reglas usan el modo simulado.
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { q } from './db.js';
import { nowIso } from './clock.js';
import { log } from './audit.js';
import { correoConfig, direccionValida, ESPERAS_MIN } from './correo-config.js';

// ---------- MIME ----------
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const lineas76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const encabezado = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function direccionConNombre(s) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m ? `${encabezado(m[1].replace(/"/g, ''))} <${m[2]}>` : s;
}
const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Versión HTML sobria del aviso (fondo claro: los correos se leen en clientes claros; azul #1565C0 cumple AA). */
export function cuerpoHtml(asunto, texto, cfg) {
  const parrafos = escHtml(texto).split(/\n+/).map((p) => `<p style="margin:0 0 14px">${p.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1565C0">$1</a>')}</p>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1b2533">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5f0">
<tr><td style="background:#0D1117;padding:18px 24px;color:#F0F4FF;font-size:18px;font-weight:bold"><span style="color:#42A5F5">Mun</span>IA OMIL <span style="font-weight:normal;font-size:12px;color:#8B9DC3">· Oficina Municipal de Información Laboral de Casablanca</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55"><h1 style="font-size:17px;margin:0 0 16px;color:#0D1117">${escHtml(asunto)}</h1>${parrafos}</td></tr>
<tr><td style="padding:14px 24px;background:#f7f9fc;font-size:12px;color:#5a6b85;border-top:1px solid #e6ecf4">Aviso automático de la OMIL de Casablanca (Chacabuco N°440). Para consultas escriba a ${escHtml(cfg.responderA)} o llame al 32 2277406.</td></tr>
</table></td></tr></table></body></html>`;
}

export function armarMensaje(aviso, para, cfg) {
  const limite = `traza-${randomBytes(9).toString('hex')}`;
  const dominio = cfg.remitenteDir.split('@')[1] || 'traza-omil.local';
  const messageId = `<aviso-${aviso.id}-${randomBytes(6).toString('hex')}@${dominio}>`;
  const asunto = para !== aviso.destinatario ? `[PRUEBA → ${aviso.destinatario}] ${aviso.asunto}` : aviso.asunto;
  const datos = [
    `From: ${direccionConNombre(cfg.remitente)}`,
    `To: <${para}>`,
    `Reply-To: <${cfg.responderA}>`,
    `Subject: ${encabezado(asunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `X-Traza-Aviso: ${aviso.tipo}-${aviso.id}`,
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    lineas76(b64(aviso.cuerpo)),
    `--${limite}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    lineas76(b64(cuerpoHtml(asunto, aviso.cuerpo, cfg))),
    `--${limite}--`,
    '',
  ].join('\r\n');
  return { messageId, asunto, datos };
}

// ---------- SMTP ----------
class ErrorEnvio extends Error {
  constructor(msg, { permanente = false, rebote = false } = {}) { super(msg); this.permanente = permanente; this.rebote = rebote; }
}

export class SesionSmtp {
  constructor(cfg) { this.cfg = cfg; this.buf = ''; this.pend = null; this.err = null; }

  _attach(sock) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d) => { this.buf += d; this._revisar(); });
    sock.on('error', (e) => { this.err = e; if (this.pend) { const p = this.pend; this.pend = null; p.reject(e); } });
    sock.setTimeout(30_000, () => sock.destroy(new Error('Tiempo de espera agotado con el servidor SMTP')));
  }
  _revisar() {
    if (!this.pend) return;
    const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buf);
    if (!m) return;
    const fin = m.index + m[0].length;
    const texto = this.buf.slice(0, fin).trim();
    this.buf = this.buf.slice(fin);
    const p = this.pend; this.pend = null;
    p.resolve({ codigo: Number(m[1]), texto });
  }
  leer() {
    return new Promise((resolve, reject) => {
      if (this.err) return reject(this.err);
      this.pend = { resolve, reject };
      this._revisar();
    });
  }
  async cmd(linea, ok = [250], oculto = false) {
    this.sock.write(`${linea}\r\n`);
    const r = await this.leer();
    if (!ok.includes(r.codigo)) {
      const ultima = r.texto.split('\r\n').pop();
      throw new ErrorEnvio(`SMTP ${oculto ? 'AUTH' : linea.split(' ')[0]} → ${ultima}`, { permanente: r.codigo >= 500 });
    }
    return r;
  }

  async abrir() {
    const { host, puerto, seguridad, usuario, clave, helo } = this.cfg.smtp;
    const sock = seguridad === 'tls' ? tls.connect({ host, port: puerto, servername: host }) : net.connect({ host, port: puerto });
    this._attach(sock);
    const saludo = await this.leer();
    if (saludo.codigo !== 220) throw new ErrorEnvio(`El servidor SMTP rechazó la conexión: ${saludo.texto}`);
    let ehlo = await this.cmd(`EHLO ${helo}`);
    if (seguridad === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.texto)) throw new ErrorEnvio('El servidor SMTP no ofrece STARTTLS (configure SMTP_SEGURIDAD)', { permanente: true });
      await this.cmd('STARTTLS', [220]);
      this.sock.removeAllListeners('data');
      this.sock.setTimeout(0);
      const t = tls.connect({ socket: this.sock, servername: host });
      this.buf = '';
      this._attach(t);
      await once(t, 'secureConnect');
      ehlo = await this.cmd(`EHLO ${helo}`);
    }
    if (usuario) {
      if (/AUTH[^\r\n]*PLAIN/i.test(ehlo.texto)) await this.cmd(`AUTH PLAIN ${b64(`\0${usuario}\0${clave}`)}`, [235], true);
      else {
        await this.cmd('AUTH LOGIN', [334], true);
        await this.cmd(b64(usuario), [334], true);
        await this.cmd(b64(clave), [235], true);
      }
    }
  }

  async enviar(de, para, datos) {
    await this.cmd(`MAIL FROM:<${de}>`);
    try {
      await this.cmd(`RCPT TO:<${para}>`, [250, 251]);
    } catch (e) {
      await this.cmd('RSET').catch(() => {});
      if (e.permanente) e.rebote = true; // 5xx en el destinatario: buzón inexistente o rechazado
      throw e;
    }
    await this.cmd('DATA', [354]);
    const cuerpo = datos.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    return this.cmd(`${cuerpo}\r\n.`);
  }

  cerrar() {
    try { this.sock.write('QUIT\r\n'); this.sock.end(); } catch { /* ya cerrado */ }
  }
}

// ---------- Resend (servicio de correo transaccional por API) ----------
async function enviarResend(aviso, para, cfg, msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `traza-aviso-${aviso.id}` },
    body: JSON.stringify({ from: cfg.remitente, to: [para], reply_to: cfg.responderA, subject: msg.asunto, text: aviso.cuerpo,
      html: cuerpoHtml(msg.asunto, aviso.cuerpo, cfg), headers: { 'X-Traza-Aviso': `${aviso.tipo}-${aviso.id}`, 'Auto-Submitted': 'auto-generated' } }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j.id || msg.messageId;
  throw new ErrorEnvio(`Resend ${r.status}: ${j.message || r.statusText}`, { permanente: r.status >= 400 && r.status < 500 && r.status !== 429 });
}

// ---------- cola ----------
let ocupado = false;

function marcar(aviso, estado, extra = {}) {
  const cols = Object.keys(extra);
  q.run(`UPDATE avisos SET estado_entrega=?${cols.map((c) => `, ${c}=?`).join('')} WHERE id=?`, estado, ...cols.map((c) => extra[c]), aviso.id);
  const det = { intentos: extra.intentos ?? aviso.intentos, error: extra.ultimo_error || undefined, redirigido: extra.redirigido_a || undefined };
  log({ entidad: 'aviso', entidad_id: aviso.id, oferta_id: aviso.oferta_id, accion: `aviso ${aviso.tipo} ${estado === 'entregado' ? 'enviado' : estado}`, despues: det });
}

/** Procesa los avisos pendientes cuyo próximo intento ya venció. Devuelve un resumen. */
export async function procesarCola({ limite = 50 } = {}) {
  const cfg = correoConfig();
  const res = { enviados: 0, rebotados: 0, errores: 0, retenidos: 0, reintentos: 0 };
  if (!cfg.real || ocupado) return res;
  ocupado = true;
  let smtp = null;
  try {
    const pendientes = q.all(`SELECT * FROM avisos WHERE estado_entrega='pendiente' AND (proximo_intento IS NULL OR proximo_intento <= ?) ORDER BY id LIMIT ?`, nowIso(), limite);
    for (const a of pendientes) {
      if (!cfg.produccion && !cfg.redirigirA) {
        marcar(a, 'retenido', { ultimo_error: 'Entorno de pruebas sin CORREO_REDIRIGIR_A: no se envía a destinatarios reales' });
        res.retenidos++;
        continue;
      }
      const para = cfg.produccion ? a.destinatario : cfg.redirigirA;
      if (!direccionValida(para)) { marcar(a, 'rebotado', { ultimo_error: 'Dirección inválida' }); res.rebotados++; continue; }
      const intentos = a.intentos + 1;
      const msg = armarMensaje(a, para, cfg);
      try {
        let id;
        if (cfg.modo === 'smtp') {
          if (!smtp) { smtp = new SesionSmtp(cfg); await smtp.abrir(); }
          await smtp.enviar(cfg.remitenteDir, para, msg.datos);
          id = msg.messageId;
        } else {
          id = await enviarResend(a, para, cfg, msg);
        }
        marcar(a, 'entregado', { intentos, entregado_at: nowIso(), id_proveedor: id, ultimo_error: null, proximo_intento: null, redirigido_a: para !== a.destinatario ? para : null });
        res.enviados++;
      } catch (e) {
        if (!(e instanceof ErrorEnvio) && smtp) { smtp.cerrar(); smtp = null; } // error de red: reabrir en el siguiente
        if (e.rebote) { marcar(a, 'rebotado', { intentos, ultimo_error: e.message }); res.rebotados++; continue; }
        if (e.permanente || intentos >= cfg.maxIntentos) { marcar(a, 'error', { intentos, ultimo_error: e.message }); res.errores++; if (smtp && e.permanente) { smtp.cerrar(); smtp = null; } continue; }
        const espera = ESPERAS_MIN[Math.min(intentos - 1, ESPERAS_MIN.length - 1)];
        q.run('UPDATE avisos SET intentos=?, ultimo_error=?, proximo_intento=? WHERE id=?', intentos, e.message, new Date(Date.parse(nowIso()) + espera * 60_000).toISOString(), a.id);
        res.reintentos++;
      }
    }
  } finally {
    if (smtp) smtp.cerrar();
    ocupado = false;
  }
  return res;
}
