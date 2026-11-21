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
npm test             # 21 pruebas: reglas y plazos con reloj simulado (9.7) + correo contra un SMTP de prueba
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

## Correo de avisos

Los avisos (A1–A4, E0–E4, T0) pasan por una **cola**: se registran como *En cola* dentro de la misma transacción
que los genera y un despachador los envía cada 15 segundos (y justo después de cada acción), con reintentos a los
1, 2, 5, 10, 20 y 30 minutos (≈ 1 hora, RN-04). Estados: **En cola → Enviado** (aceptado por el servidor de correo),
**Rebotado** (destinatario rechazado, o aviso de no entrega registrado a mano), **Error de envío** (intentos agotados)
y **Retenido** (salvaguarda de pruebas). Los con error o retenidos se reintentan desde *Avisos* o *Administración*.

Configuración: copie `.env.ejemplo` como `.env` y reinicie (`npm start` lo carga solo). Tres modos:

| `CORREO_MODO` | Uso |
|---|---|
| `simulado` (predeterminado) | No envía: bandeja interna. Demo y pruebas. |
| `smtp` | Cuenta institucional (Microsoft 365 `smtp.office365.com:587` o Google Workspace `smtp.gmail.com:587` con contraseña de aplicación) o el relay del municipio. STARTTLS o TLS, autenticación PLAIN/LOGIN. |
| `resend` | Servicio transaccional por API, con el dominio municipal verificado. Recomendado para el volumen anual (~20.000 avisos). |

**Salvaguarda:** si `TRAZA_ENTORNO` no es `produccion`, *todo* aviso se desvía a `CORREO_REDIRIGIR_A` con el asunto
`[PRUEBA → destinatario original]`; sin ese buzón, los avisos quedan *Retenidos* y no sale nada. En producción no se
carga el escenario de demostración. Para probar: *Administración → Correo de avisos → Enviar correo de prueba*.

**Límites de las cuentas de oficina:** Microsoft 365 permite unos 10.000 destinatarios al día y 30 mensajes por minuto
por buzón; Google Workspace, unos 2.000 al día. Alcanzan para el uso diario de la OMIL (~80 avisos/día), pero un cierre
masivo o el barrido inicial del stock conviene hacerlo con el servicio transaccional.

### Lista de tareas para Informática (antes de producción)

1. Crear la casilla remitente (ej. `omil@municipalidadcasablanca.cl`) y la de respuestas `omilpersonas@…`.
2. **SPF**: incluir el servicio que envía en el registro TXT del dominio (ej. `include:spf.protection.outlook.com`).
3. **DKIM**: activar la firma para el dominio en Microsoft 365 / Google Workspace, o publicar los registros que entregue Resend.
4. **DMARC**: publicar `_dmarc.municipalidadcasablanca.cl` (partir en `p=none` con reportes y subir a `quarantine`).
5. Si es SMTP de Microsoft 365: habilitar *SMTP AUTH* solo para la casilla remitente.
6. Revisar periódicamente la casilla remitente: los avisos de no entrega que lleguen se marcan como *Rebotó* en *Avisos*.
7. Guardar las claves solo en el `.env` del servidor (nunca en git) y rotarlas al egreso de quien las administre.

## Lo que el MVP simula y falta para producción

- **Correo**: el envío real ya está implementado (ver *Correo de avisos*); falta la configuración DNS del dominio y las credenciales. Los rebotes que llegan después del envío se registran a mano (no se lee la casilla automáticamente).
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
lib/notify.js          plantillas, generación de avisos y cola
lib/correo-config.js   configuración del correo (variables de entorno)
lib/mailer.js          despacho real: SMTP y Resend, reintentos
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
