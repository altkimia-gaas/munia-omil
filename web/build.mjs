// Compila la demo navegable en un único archivo: docs/index.html (GitHub Pages, sin servidor).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = (p) => resolve(root, 'web', p);

const swap = {
  name: 'swap-node-modules',
  setup(b) {
    b.onResolve({ filter: /^\.\/db\.js$/ }, (a) => (a.importer.includes('/lib/') ? { path: web('db-browser.js') } : undefined));
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: web('shim-crypto.js') }));
    b.onResolve({ filter: /^node:fs$/ }, () => ({ path: web('shim-fs.js') }));
  },
};

const out = await build({
  entryPoints: [web('main.js')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  minify: true, write: false, plugins: [swap], legalComments: 'none',
  define: { 'process.argv': '[]' },
  external: ['fs', 'path', 'crypto'],
});
const js = out.outputFiles[0].text;
const css = readFileSync(resolve(root, 'public/style.css'), 'utf8');
const appjs = readFileSync(resolve(root, 'public/app.js'), 'utf8');
const wasm = readFileSync(resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm')).toString('base64');

const page = `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MunIA OMIL · Traza OMIL (demo)</title>
<meta name="description" content="Demo navegable de Traza OMIL: gestión y trazabilidad de la intermediación laboral municipal. Datos ficticios.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${css}</style></head>
<body><div style="min-height:100vh;display:grid;place-items:center;color:#8B9DC3;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:2px">CARGANDO TRAZA OMIL…</div>
<script>window.__SQL_WASM__="${wasm}";</script>
<script>${appjs}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/index.html'), page);
writeFileSync(resolve(root, 'docs/.nojekyll'), '');
console.log(`docs/index.html listo (${(page.length / 1024).toFixed(0)} KB)`);
