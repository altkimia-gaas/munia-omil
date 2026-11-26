// Herramientas de administración por consola.
//   node --env-file-if-exists=.env lib/admin-cli.js crear-admin correo@municipalidadcasablanca.cl "Nombre Apellido"
//   node --env-file-if-exists=.env lib/admin-cli.js restablecer correo@municipalidadcasablanca.cl
// Imprime el enlace de activación (además de enviarlo por correo si el correo real está configurado).
import { fileURLToPath } from 'node:url';
import { openDb, q } from './db.js';
import { seedBase } from './seed.js';
import { enviarEnlaceAcceso, usuarioPorCorreo } from './auth.js';
import { procesarCola } from './mailer.js';

const [cmd, correo, nombre] = process.argv.slice(2);
openDb(process.env.TRAZA_DB || fileURLToPath(new URL('../data/traza.db', import.meta.url)));
seedBase();
let u = usuarioPorCorreo(correo);
if (cmd === 'crear-admin') {
  if (!correo || !nombre) { console.error('Uso: crear-admin <correo> "<nombre>"'); process.exit(1); }
  if (!u) {
    q.run(`INSERT INTO usuarios(nombre, correo, rol, creado_at) VALUES (?,?, 'admin', ?)`, nombre, correo.toLowerCase(), new Date().toISOString());
    u = usuarioPorCorreo(correo);
  }
} else if (cmd !== 'restablecer' || !u) {
  console.error('Uso: crear-admin <correo> "<nombre>"  |  restablecer <correo existente>');
  process.exit(1);
}
const r = enviarEnlaceAcceso(u, 'activacion', 'consola');
await procesarCola();
console.log(`Enlace de activación para ${u.correo} (vigente 72 h, un solo uso):\n${r.enlace}`);
