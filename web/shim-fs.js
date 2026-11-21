// Sustituto de node:fs para la demo en el navegador (el seed solo lo usa en modo línea de comandos).
export const rmSync = () => {};
export const mkdirSync = () => {};
export const existsSync = () => false;
export const readFileSync = () => '';
