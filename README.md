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
npm test             # 33 pruebas: reglas y plazos (9.7), correo, acceso, firma, respaldos, BNE, orientación y ayuda
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
| `/login` → botón Jefatura (demo) | Panel diario, OF-0007 bloqueada por RN-09, OF-0008 con requisito discriminatorio, OF-0004 con resultado por validar |
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

## Acceso de funcionarios

- **Contraseña** (scrypt, mínimo 12 caracteres con letras y números) + **doble factor obligatorio** con una aplicación
  autenticadora (Microsoft o Google Authenticator, códigos TOTP de 6 dígitos).
- **Alta:** el administrador crea el usuario en *Administración*; el sistema envía un enlace de activación de un solo uso
  (72 h) para definir la contraseña y configurar el doble factor. El enlace nunca queda legible en la bandeja de avisos.
- **Primer administrador** (servidor recién instalado):

  ```bash
  npm run crear-admin -- informatica@municipalidadcasablanca.cl "Nombre Apellido"
  ```

- *¿Olvidaste tu contraseña?* envía un enlace para restablecerla. Si alguien pierde el teléfono, el administrador usa
  **Restablecer acceso**. Bloqueo de 15 min tras 5 intentos fallidos. Sesiones de 8 h guardadas en la base (sobreviven a
  un reinicio). Dar de baja a un usuario corta sus sesiones al instante.
- **Ingreso de demostración** (botones por rol, sin contraseña): disponible fuera de producción para mostrar el sistema;
  se desactiva con `TRAZA_LOGIN_DEMO=0` y **nunca** existe con `TRAZA_ENTORNO=produccion`.

## Firma de declaraciones

Los funcionarios firman con su sesión autenticada (contraseña + doble factor). Los entrevistadores de las Direcciones
firman en el enlace de la oferta con un **código de un solo uso enviado a su correo** (vence en 15 min, 5 intentos).
Cada declaración guarda cómo se verificó la identidad y un **sello SHA-256** de su contenido. Si un entrevistador no
tiene correo registrado, la declaración queda como firma simple y así se indica.

## Respaldos

Copia diaria automática desde las 02:00 (`TRAZA_RESPALDO_HORA`), cifrada con AES-256-GCM si se define
`TRAZA_RESPALDO_CLAVE`, en `data/respaldos/` (`TRAZA_RESPALDOS`), con retención de 30 copias (`TRAZA_RESPALDO_DIAS`).
*Administración → Respaldos* permite respaldar ahora y **probar la restauración**. Restaurar, con el servidor detenido:

```bash
npm run respaldo -- restaurar traza-AAAA-MM-DDTHH-MM-SS.db.enc
```

Informática debe copiar la carpeta de respaldos fuera del servidor y guardar la clave en un lugar distinto.

## Rebotes automáticos

Con Resend, configure un webhook a `https://<servidor>/webhooks/correo` (eventos *email.delivered*, *email.bounced*,
*email.complained*) y ponga su secreto en `RESEND_WEBHOOK_SECRET`. La firma Svix se verifica en cada llamada. Con SMTP
los rebotes que llegan a la casilla se siguen registrando a mano con **Rebotó** en *Avisos*.

## Conciliación con BNE (M12) y Orientación (M13)

- **Conciliación BNE:** cargue cada mes el CSV exportado de la Bolsa Nacional de Empleo. El sistema cruza por RUT (y por
  oferta si viene) y muestra lo que falta registrar en BNE y lo que BNE tiene sin resultado en Traza; marca como
  registradas las ofertas completas.
- **Orientación:** motivos de no cumplimiento de los últimos 6 meses, talleres dirigidos e invitaciones (aviso O1) solo a
  quienes dieron el consentimiento específico de *talleres y capacitación*, y registro de derivaciones a cursos SENCE.

## Ayuda

Botón **Ayuda** en la barra superior de todas las pantallas (o tecla `?`): abre la guía de la pantalla en la que está.
`/app/ayuda` trae primeros pasos según el rol, guías por módulo, preguntas frecuentes con buscador y glosario.
`/ayuda` es la ayuda pública para postulantes y empleadores.

## Antes de producción (lo que depende de la Municipalidad)

| Tarea | Responsable |
|---|---|
| Servidor con HTTPS (`TRAZA_URL=https://…`), disco cifrado y copia externa de `data/respaldos` | Informática |
| Correo: casillas, SPF/DKIM/DMARC y credenciales en `.env` (ver *Correo de avisos*) | Informática |
| `TRAZA_RESPALDO_CLAVE` y `RESEND_WEBHOOK_SECRET` en `.env`; guardar la clave de respaldos fuera del servidor | Informática |
| `npm run crear-admin` y alta de los funcionarios desde *Administración* | Informática |
| Textos de consentimientos y aviso de privacidad; plazo de conservación por decreto | Asesoría Jurídica |
| Confirmar feriados 2027 en *Administración → Feriados* | Administrador |
| Formato del CSV de BNE y mecanismo de carga con la Dirección Regional de SENCE | Jefatura OMIL |
| Evaluación de impacto en protección de datos (Ley N°21.719) | Encargado/a de datos |
| `TRAZA_ENTORNO=produccion` (desactiva el ingreso de demostración y la redirección de correos) | Informática |

**No incluido:** firma electrónica avanzada con FirmaGob (requiere convenio con la Secretaría de Gobierno Digital) e
integración directa por API con BNE (depende de lo que habilite SENCE); el sistema deja ambos puntos resueltos con
alternativas trazables (código por correo y conciliación por archivo).

## Estructura

```
server.js              servidor HTTP y enrutador
lib/db.js              esquema (modelo de datos 8.1) y triggers de bitácora
lib/engine.js          núcleo: estados, reglas, temporizadores, probidad, muestra
lib/notify.js          plantillas, generación de avisos y cola
lib/correo-config.js   configuración del correo (variables de entorno)
lib/mailer.js          despacho real: SMTP y Resend, reintentos
lib/auth.js            contraseñas, doble factor TOTP, activación, sesiones
lib/respaldo.js        respaldos cifrados y restauración (también por consola)
lib/ayuda.js           contenido del centro de ayuda
lib/routes-ayuda.js    pantallas de ayuda
lib/routes-servidor.js rutas solo de servidor: respaldos y webhook de correo
lib/admin-cli.js       crear el primer administrador o restablecer un acceso
public/app.js          menú móvil, buscador de la ayuda, lectura de CSV
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
