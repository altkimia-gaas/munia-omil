# MunIA OMIL · Traza OMIL — MVP

> Demo navegable (GitHub Pages): **https://altkimia-gaas.github.io/munia-omil/**
> Datos ficticios. La demo corre entera en el navegador y no es el portal oficial de la OMIL.

Sistema de gestión y trazabilidad de la intermediación laboral de la OMIL de Casablanca,
construido según el *Informe de diseño de detalle* (20-11-2026). Cada oferta y cada postulación
es un expediente con estado, plazo y aviso automático al postulante.

## Ejecutar

Requisito: Node.js 22.5 o superior (usa el SQLite integrado; el servidor **no tiene dependencias de ejecución**).

```bash
npm start            # http://localhost:3000  — la primera vez carga un escenario de demostración
npm test             # 13 pruebas de reglas y temporizadores con reloj simulado (prueba 9.7)
npm run seed         # reinicia la base con el escenario de demostración
```

Variables: `PORT`, `TRAZA_DB` (ruta de la base), `TRAZA_URL` (URL pública para el enlace del empleador),
`TRAZA_DEMO=0` (base vacía, sin escenario).

## Demo publicada (GitHub Pages)

La carpeta `docs/` contiene un único `index.html` con el mismo núcleo y las mismas pantallas del servidor,
ejecutados en el navegador (SQLite en WebAssembly vía sql.js). No hay backend: cada visitante tiene su propia
copia de los datos ficticios en `localStorage` y puede volver al estado inicial con **Reiniciar demo**.

```bash
npm install          # solo herramientas de compilación (esbuild, sql.js)
npm run build:demo   # regenera docs/index.html
```

Para publicar una nueva versión: `npm run build:demo`, commit y push a `main`. GitHub Pages sirve `main:/docs`
(igual que MunIA Fomento) y se actualiza solo en ~1 minuto.

## Recorrido sugerido

| Dónde | Qué mirar |
|---|---|
| `/` | Página pública (M11): ofertas vigentes, en selección y cerradas, sin datos personales |
| `/ofertas/OF-2026-0006` | Postulación con consentimiento obligatorio + banco de futuras ofertas separado (RN-18) |
| `/mis-postulaciones` | Estado visible para el postulante, avisos recibidos, retiro, revocación y derechos (CU-12, CU-15) |
| `/empleadores/publicar` | Formulario descriptor con condición de servicio |
| `/login` → botón Jefatura | Panel diario, OF-0007 bloqueada por RN-09, OF-0008 con requisito discriminatorio, OF-0004 con resultado por validar |
| Expediente OF-2026-0003 | Oferta municipal: declaraciones, abstención con reemplazo, acta y marca RN-13 |
| Barra "Modo prueba de plazos" | Avanza el reloj: derivación automática, recordatorios día 10/20, cierre a 30 días con Aviso 4 |
| `/login` → botón Control | Genera la muestra semestral reproducible y registra hallazgos |
| Auditoría | Bitácora encadenada SHA-256, verificación de integridad; la BD bloquea UPDATE/DELETE |

## Qué cubre del informe

- **Estados** de oferta y postulación (7.2) con transiciones controladas por el núcleo.
- **Reglas RN-01 a RN-19**: clasificación calculada y corrección justificada, derivación total, plazos de avisos,
  recordatorios, cierre a 30 días, RN-09, probidad bloqueante (RN-10 a RN-13), reapertura solo jefatura, días hábiles
  con feriados parametrizables, duplicados, supresión "menos de 5", consentimiento separado y conservación con anonimización.
- **Avisos** A1–A4, E0–E4, I1–I2 con plantillas versionadas editables y registro de entrega/rebote.
- **Canal del empleador** por enlace único sin cuenta: nómina (+CSV), resultado y, en ofertas municipales, declaraciones y acta.
- **Matriz de permisos** (5.3) por rol y por oferta.
- **Auditoría**: bitácora inalterable y encadenada, muestra semestral con semilla registrada, vista de solo lectura para Control.
- **Reportería**: informe trimestral al Concejo (exportable), panel diario e indicadores 11.2.
- **Datos**: exportación completa CSV/JSON, archivo de conciliación BNE, API pública `/api/ofertas.json`.

## Lo que el MVP simula y falta para producción

- **Correo**: los avisos quedan en la bandeja de salida (`/app/avisos`); falta conectar el servicio masivo con SPF/DKIM/DMARC (`lib/notify.js → deliver`).
- **Autenticación**: el login es un selector de usuarios de demostración; falta cuenta institucional con doble factor.
- **Firma**: declaraciones y actas usan firma simple; FirmaGob queda por evaluar.
- **BNE**: solo exportación de conciliación; la integración depende de lo que habilite SENCE.
- **Sesiones** en memoria; cifrado en reposo, respaldos y despliegue dependen de la infraestructura municipal.
- Textos legales (consentimientos, aviso de privacidad) y feriados 2027 deben validarse con Asesoría Jurídica.

## Estructura

```
server.js              servidor HTTP y enrutador
lib/db.js              esquema (modelo de datos 8.1) y triggers de bitácora
lib/engine.js          núcleo: estados, reglas, temporizadores, probidad, muestra
lib/notify.js          plantillas y envío de avisos
lib/audit.js           bitácora encadenada
lib/clock.js           reloj (con desfase simulado) y días hábiles
lib/reports.js         informe trimestral, panel e indicadores
lib/routes-public.js   portal del postulante, canal del empleador, página pública
lib/routes-staff.js    back-office por rol
lib/seed.js            datos base y escenario de demostración
lib/schema.js          esquema compartido por servidor y demo
web/                   demo navegable: adaptadores (sql.js, crypto), enrutador y compilación
docs/index.html        demo compilada para GitHub Pages
test/reglas.test.js    pruebas de reglas y plazos
```
