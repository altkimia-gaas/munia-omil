// Contenido del centro de ayuda. Texto plano con **negritas**; se renderiza en lib/routes-ayuda.js.

/** Primeros pasos según el rol de quien entra. */
export const PRIMEROS_PASOS = {
  ejecutivo: [
    'Abre el **Panel** cada mañana: muestra lo que vence hoy, las postulaciones sin clasificar y los resultados que debes validar.',
    'En **Ofertas**, revisa las que están *En validación*: verifica que los requisitos sean objetivos y publícalas, u obsérvalas para que el empleador las corrija.',
    'Mientras la oferta está *Publicada*, **clasifica** cada postulación con la lista de chequeo. Si recibes postulaciones en persona o por correo, regístralas en el expediente.',
    'Al vencer el plazo, el sistema **deriva solo** la nómina al empleador y avisa a los postulantes. No tienes que enviar correos.',
    'Cuando el empleador informe el resultado, aparece en rojo en el Panel: **valida y cierra** para que salga el Aviso 3 dentro de 5 días hábiles.',
  ],
  jefatura: [
    'El **Panel** te muestra la carga de cada ejecutivo, las abstenciones que necesitan reemplazo y los resultados por validar.',
    'Autoriza las ofertas de empleadores con un cierre sin respuesta en los últimos 12 meses (regla RN-09) y **reasigna** ofertas cuando alguien declara un vínculo.',
    'Revisa **Avisos** para ver la cola de correo, los rebotes y reintentar los que fallaron.',
    'Cada trimestre, saca el **informe al Concejo** desde Reportes y regístrale las colocaciones ponderadas de BNE.',
    'Responde en **Auditoría** los hallazgos de la Dirección de Control con un plan de acción. Solo tú puedes **reabrir** una oferta cerrada.',
  ],
  control: [
    'En **Auditoría** verifica que la bitácora esté íntegra: el sistema comprueba la cadena de huellas en cada visita.',
    'Cada semestre, **genera la muestra** de ofertas cerradas. Anota la semilla: con ella cualquiera puede reproducir la misma selección.',
    'Abre cada expediente de la muestra en **solo lectura**: bitácora, clasificación, declaraciones, acta y avisos.',
    'Registra los **hallazgos** con su gravedad; la jefatura OMIL responde con un plan de acción.',
  ],
  dideco: [
    'En **Reportes** tienes el informe trimestral al Concejo y los indicadores de gestión de la sección 11.2.',
    'En **Orientación** ves por qué no calzan las postulaciones, para priorizar talleres y capacitación.',
  ],
  dpo: [
    'En **Datos personales** atiende las solicitudes de los titulares (acceso, rectificación, supresión…) antes de su plazo.',
    'Revisa los expedientes congelados por denuncia y el resumen de consentimientos. La anonimización por plazo de conservación es automática.',
  ],
  admin: [
    'En **Administración** crea los usuarios: el sistema les envía un enlace para definir su contraseña y activar el doble factor.',
    'Configura el **correo** (archivo .env del servidor) y usa *Enviar correo de prueba*.',
    'Revisa los **respaldos** diarios y prueba una restauración al menos una vez al mes.',
    'Mantén el calendario de **feriados** al día: de él dependen todos los plazos en días hábiles.',
    'Da de baja el **mismo día** del egreso a quien deje la municipalidad: se cierran sus sesiones.',
  ],
};

/** Guías por módulo. `ruta` relaciona el botón Ayuda de cada pantalla con su guía. */
export const GUIAS = [
  { id: 'acceso', titulo: 'Entrar al sistema', roles: 'todos', ruta: '/login', pasos: [
    'Entra con tu **correo institucional** y tu **contraseña**.',
    'Luego escribe el **código de 6 dígitos** de tu aplicación autenticadora (Microsoft o Google Authenticator).',
    '**Primera vez:** usa el enlace de activación que te llegó por correo, define una contraseña de al menos 12 caracteres con letras y números, y agrega la cuenta en la aplicación con la clave que se muestra.',
    '¿Olvidaste la contraseña? Usa *¿Olvidaste tu contraseña?* en la pantalla de ingreso. ¿Perdiste el teléfono? Pide al administrador que **restablezca tu acceso**.',
    'Tras 5 intentos fallidos la cuenta se bloquea 15 minutos. La sesión dura 8 horas.',
  ] },
  { id: 'panel', titulo: 'Panel diario', roles: 'Ejecutivo, Jefatura', ruta: '/app', pasos: [
    'Las tarjetas de arriba son atajos: haz clic para ir a cada lista.',
    '**Resultados por validar (Aviso 3)** en rojo: el empleador ya respondió y hay 5 días hábiles para avisar a los no seleccionados.',
    '**Avisos no entregados**: llama por teléfono a esas personas y corrige su correo.',
    'Las **alertas** (I1, I2) son recordatorios internos: no salen por correo.',
  ] },
  { id: 'ofertas', titulo: 'Ciclo de una oferta', roles: 'Ejecutivo, Jefatura', ruta: '/app/ofertas', pasos: [
    '**En validación** → revisa requisitos. El sistema marca en rojo los que podrían discriminar (sexo, edad, estado civil…). Publica, u **observa** para devolverla al empleador.',
    '**Publicada** → recibe postulaciones hasta la fecha de cierre (por defecto 10 días hábiles). El empleador recibe el aviso E1.',
    '**Derivada** → al día hábil siguiente al cierre, el sistema envía la nómina completa al empleador con un enlace único (E2) y el Aviso 2 a todos los postulantes.',
    'El empleador recibe recordatorios los días **10 y 20**. Si no responde, el día **30** la oferta se cierra sola con el Aviso 4 y el empleador queda marcado.',
    '**Cerrada** → registra las contrataciones en BNE y marca *Registrada en BNE*.',
    'Para registrar una oferta recibida por correo o en persona usa **Nueva oferta**.',
  ] },
  { id: 'clasificar', titulo: 'Clasificar postulaciones', roles: 'Ejecutivo', ruta: '/app/postulaciones', pasos: [
    'En el expediente, sección *Postulaciones*, haz clic en **Clasificar**.',
    'Marca cada requisito como *Acredita*, *No acredita* o *No informado*. Si no acredita, elige el **motivo**: alimenta la orientación laboral.',
    'La clasificación **cumple / no cumple** se calcula sola: solo cuentan los requisitos excluyentes.',
    'Si necesitas corregirla, abre *Corregir la clasificación* y escribe una **justificación**: queda en la bitácora.',
    'Al guardar, el sistema te lleva a la siguiente postulación pendiente.',
  ] },
  { id: 'probidad', titulo: 'Ofertas municipales (probidad)', roles: 'Ejecutivo, Jefatura, Direcciones', ruta: '/app/ofertas#probidad', pasos: [
    'Antes de ver la nómina, el ejecutivo y cada entrevistador **declaran vínculos** con los postulantes.',
    'Los entrevistadores firman en el enlace de la Dirección con un **código que llega a su correo** (vence en 15 minutos). Cada declaración queda con un sello que detecta cualquier alteración.',
    'Quien declara un vínculo queda **inhabilitado** en esa oferta. La jefatura reasigna la oferta o designa un reemplazo.',
    'La Dirección no puede informar el resultado sin **acta de selección**. Si elige a alguien clasificado "no cumple", debe justificarlo y el caso entra a la muestra de Control.',
  ] },
  { id: 'cierre', titulo: 'Resultado y cierre', roles: 'Ejecutivo, Jefatura', ruta: '/app/ofertas#cierre', pasos: [
    'El empleador informa el resultado con su enlace único: a quiénes contrató, o si el proceso quedó desierto o anulado.',
    'Tú **validas y cierras**: el seleccionado no recibe aviso masivo (lo contacta el empleador). Los demás reciben el **Aviso 3**.',
    'Solo la jefatura puede **reabrir** una oferta cerrada, con justificación; se abre un nuevo plazo de 30 días.',
    'Si llega una denuncia por la OIRS, **vincula el caso**: el expediente queda congelado contra eliminación.',
  ] },
  { id: 'avisos', titulo: 'Avisos y correo', roles: 'Ejecutivo, Jefatura', ruta: '/app/avisos', pasos: [
    'Todos los avisos pasan por una **cola**: *En cola* → *Enviado*. Si el servidor de correo falla, se reintenta durante una hora.',
    '**Rebotado**: la dirección no existe o fue rechazada. Llama a la persona y corrige su correo.',
    '**Error** o **Retenido**: usa *Reintentar*. *Retenido* significa que el sistema está en modo de pruebas sin buzón de prueba configurado.',
    'Si te llega a la casilla de la OMIL un aviso de "no entregado", búscalo aquí y usa **Rebotó**.',
    'Las plantillas de los avisos las edita la jefatura en **Plantillas**; cada cambio crea una versión nueva.',
  ] },
  { id: 'orientacion', titulo: 'Orientación laboral', roles: 'Ejecutivo, Jefatura, DIDECO', ruta: '/app/orientacion', pasos: [
    'El gráfico muestra **por qué no calzan** las postulaciones de los últimos 6 meses.',
    'Crea un **taller** dirigido a un motivo (por ejemplo, "Sin licencia exigida") y luego invita a las personas de la lista.',
    'Solo aparecen personas que **autorizaron** recibir invitaciones a talleres. La invitación sale como aviso O1.',
    'Registra las **derivaciones a cursos SENCE** y actualiza su estado (inscrita, finalizada).',
  ] },
  { id: 'reportes', titulo: 'Informe al Concejo', roles: 'Jefatura, DIDECO, Control', ruta: '/app/reportes', pasos: [
    'Elige el trimestre. El informe **no contiene datos personales** y las cifras menores a 5 aparecen como "menos de 5".',
    'Personas contratadas y colocaciones ponderadas SENCE van en **filas separadas**: no son lo mismo.',
    'La jefatura registra el dato de **colocaciones ponderadas** que entrega BNE.',
    'Usa **Exportar a planilla** para adjuntarlo al oficio.',
  ] },
  { id: 'bne', titulo: 'Conciliación con BNE', roles: 'Ejecutivo, Jefatura', ruta: '/app/bne', pasos: [
    'Cada mes, exporta desde BNE las colocaciones de la oficina en CSV.',
    'Cárgalo en **Conciliación BNE**: el sistema cruza por RUT (y por oferta, si el archivo la trae).',
    '**Solo en Traza**: contrataciones que falta registrar en BNE. **Solo en BNE**: pide el resultado al empleador.',
    'Las ofertas con todas sus contrataciones en BNE quedan marcadas como registradas.',
  ] },
  { id: 'auditoria', titulo: 'Auditoría y muestra semestral', roles: 'Control, Jefatura', ruta: '/app/auditoria', pasos: [
    'La **bitácora** registra cada acción con usuario, fecha y hora, valor anterior y nuevo. No se puede editar ni borrar.',
    'La Dirección de Control **genera la muestra** del semestre. Las ofertas municipales pesan más y los casos marcados entran siempre.',
    'Los expedientes de la muestra se ven en **solo lectura**. Los hallazgos los responde la jefatura.',
  ] },
  { id: 'datos', titulo: 'Datos personales', roles: 'Encargado/a de datos, Jefatura', ruta: '/app/datos', pasos: [
    'Las personas piden **acceso, rectificación, supresión u oposición** desde *Mis postulaciones*, en persona o por correo.',
    'Resuelve cada solicitud antes de su plazo. En una supresión puedes **anonimizar** los datos, salvo que haya un expediente congelado o una postulación en curso.',
    'Los datos se anonimizan solos **24 meses** después del cierre, salvo que la persona haya autorizado el banco de futuras ofertas.',
  ] },
  { id: 'admin', titulo: 'Administración', roles: 'Administrador', ruta: '/app/admin', pasos: [
    '**Crear usuario**: nombre, correo y rol. Se envía el enlace de activación (vale 72 horas).',
    '**Restablecer acceso**: borra la contraseña y el doble factor y envía un enlace nuevo (por ejemplo, si alguien perdió el teléfono).',
    '**Dar de baja**: el mismo día del egreso. Se cierran sus sesiones abiertas.',
    '**Respaldos**: copia diaria cifrada. Usa *Probar restauración* para comprobar que se pueden recuperar.',
    '**Feriados**: agrégalos apenas se publiquen; los plazos en días hábiles dependen de ellos.',
  ] },
  { id: 'reloj', titulo: 'Probar plazos (solo pruebas)', roles: 'Jefatura, Administrador', ruta: null, pasos: [
    'En el menú lateral, *Prueba de plazos* adelanta el reloj del sistema para ver cómo se disparan derivaciones, recordatorios y cierres.',
    'Úsalo solo en el ambiente de pruebas o en la demo. *Hoy* vuelve a la fecha real; lo que ya ocurrió se mantiene.',
  ] },
];

export const PREGUNTAS = [
  ['¿Por qué la clasificación no se muestra al postulante?', 'Para no desalentar: el postulante ve "En revisión". El empleador sí recibe la clasificación, y se le envían todas las postulaciones, cumplan o no.'],
  ['¿Qué pasa si el empleador no responde?', 'Recibe recordatorios los días 10 y 20. El día 30 la oferta se cierra sola, los postulantes reciben el Aviso 4 y durante 12 meses las nuevas ofertas de ese empleador requieren autorización de la jefatura.'],
  ['¿Puedo enviar un correo a mano a un postulante?', 'Los avisos del protocolo salen solos desde las plantillas. Para algo excepcional usa la casilla de la OMIL; así no se duplican avisos ni se pierde la trazabilidad.'],
  ['Un postulante dice que no le llegó el aviso.', 'Búscalo en Avisos (filtra por tipo). Si aparece rebotado, corrige el correo y llámalo. También puede ver todos sus avisos en "Mis postulaciones" con su RUT y código de seguimiento.'],
  ['El postulante perdió su código de seguimiento.', 'El código está en el Aviso 1. Si no lo tiene, búscalo en la ficha de su postulación (correo y RUT) y verifica su identidad antes de entregárselo.'],
  ['¿Cuentan los sábados en los plazos?', 'Los plazos en días hábiles (postulación, Aviso 3) excluyen sábados, domingos y feriados. Los recordatorios y el cierre a 30 días son días corridos.'],
  ['Me equivoqué al clasificar y la oferta ya se derivó.', 'Después de la derivación la clasificación no se edita, porque el empleador ya la recibió. Deja una nota en el expediente y avisa a la jefatura.'],
  ['¿Qué significa "Retenido" en un aviso?', 'El sistema está en modo de pruebas y no tiene configurado un buzón de prueba. Así no se envía ningún correo real por error.'],
  ['¿Cómo agrego un entrevistador a una oferta municipal?', 'Los entrevistadores los indica la Dirección al ingresar la oferta. Si alguno declara vínculo, la jefatura designa un reemplazo desde el expediente.'],
  ['¿Quién puede ver los datos personales?', 'El ejecutivo, los de sus ofertas; la jefatura, todos; la Dirección solicitante, solo la nómina de su oferta; la Dirección de Control, solo los de la muestra auditada. El administrador no ve datos personales.'],
  ['¿Cada cuánto se respalda la información?', 'Todos los días, de forma automática y cifrada. Se conservan los últimos 30 respaldos.'],
  ['Perdí mi teléfono con el autenticador.', 'Pide al administrador que restablezca tu acceso: recibirás un enlace para definir una contraseña nueva y volver a configurar el doble factor.'],
];

export const GLOSARIO = [
  ['Aviso 1 (A1)', 'Confirmación de recepción al postulante, dentro de la hora.'],
  ['Aviso 2 (A2)', 'Aviso de que los antecedentes se enviaron al empleador, el mismo día hábil.'],
  ['Aviso 3 (A3)', 'Cierre del proceso para los no seleccionados, dentro de 5 días hábiles desde el resultado.'],
  ['Aviso 4 (A4)', 'Cierre por falta de respuesta del empleador, a los 30 días corridos.'],
  ['E0–E4', 'Avisos al empleador: observación, publicación, nómina con enlace único, recordatorios y cierre sin respuesta.'],
  ['Requisito excluyente', 'El único tipo que decide si una postulación "cumple". Los deseables no cuentan para la clasificación.'],
  ['Nómina', 'Lista completa de postulantes con su clasificación, que recibe el empleador.'],
  ['Enlace único', 'Dirección personal del empleador para ver la nómina e informar el resultado sin crear cuenta.'],
  ['Abstención', 'Registro de que una persona con vínculo no participa en esa oferta.'],
  ['Acta de selección', 'Documento obligatorio en ofertas municipales: entrevistados, criterio y seleccionado.'],
  ['Bitácora', 'Registro inalterable de todas las acciones, encadenado con huellas SHA-256.'],
  ['Muestra semestral', 'Selección aleatoria y reproducible de expedientes que revisa la Dirección de Control.'],
  ['Colocación ponderada', 'Indicador de SENCE que pondera según el perfil del colocado. No equivale a número de personas.'],
  ['Banco de futuras ofertas', 'Autorización voluntaria para conservar los antecedentes y avisar de nuevas ofertas.'],
  ['Doble factor', 'Segundo paso de ingreso con un código de 6 dígitos que cambia cada 30 segundos.'],
];

/** Ayuda pública: postulantes y empleadores. */
export const AYUDA_PUBLICA = [
  { id: 'postular', titulo: 'Cómo postular', pasos: [
    'Elige una oferta **vigente** en la portada y revisa los requisitos. Los marcados como **excluyentes** son los que deciden si tu postulación cumple.',
    'Completa el formulario con tu RUT, nombre y un correo o teléfono. El consentimiento para postular es obligatorio; las otras dos autorizaciones son voluntarias.',
    'Al enviar recibirás el **Aviso 1** con tu **código de seguimiento**. Guárdalo.',
    'También puedes postular en persona en **Chacabuco N°440** o por correo: la OMIL te registra el mismo día.',
  ] },
  { id: 'seguimiento', titulo: 'Saber en qué quedó mi postulación', pasos: [
    'Entra a **Mis postulaciones** con tu RUT y tu código de seguimiento.',
    'Verás el estado de cada postulación y los avisos que te enviamos: recepción, envío al empleador y cierre.',
    'Siempre recibirás un aviso de cierre, aunque el empleador no responda: a los 30 días la OMIL cierra el proceso igual.',
    'Desde ahí puedes retirar una postulación, cambiar tus autorizaciones o pedir acceso, corrección o eliminación de tus datos.',
  ] },
  { id: 'empleadores', titulo: 'Para empleadores', pasos: [
    'Publica tu oferta en **Soy empleador**. Es gratis. Los requisitos deben ser objetivos: no se aceptan exigencias de sexo, edad, estado civil u otras prohibidas por la ley.',
    'La OMIL valida la oferta y te confirma las fechas de postulación y de envío de la nómina.',
    'Recibirás la **nómina completa** con un **enlace único**. No necesitas crear una cuenta.',
    'Con ese mismo enlace informa a quiénes contrataste, o si el proceso quedó desierto. Tienes **30 días**; si no informas, el proceso se cierra y tus siguientes ofertas requerirán autorización.',
  ] },
];
export const PREGUNTAS_PUBLICAS = [
  ['¿Tiene costo postular o publicar?', 'No. El servicio de la OMIL es gratuito para personas y empleadores.'],
  ['¿Por qué dice "En revisión"?', 'La OMIL está revisando tu postulación con los requisitos de la oferta. Todas las postulaciones se envían al empleador.'],
  ['No me llegó el correo.', 'Revisa la carpeta de spam. Si no está, llama al 32 2277406 o escribe a omilpersonas@municipalidadcasablanca.cl.'],
  ['¿Quién decide la contratación?', 'El empleador entrevista y decide. La OMIL registra, deriva, hace seguimiento y te informa el resultado.'],
  ['¿Qué hacen con mis datos?', 'Solo los usamos para gestionar tu postulación y, si lo autorizas, para futuras ofertas o talleres. Se eliminan 24 meses después del cierre. Detalle en el Aviso de privacidad.'],
];

/** Ancla de la guía que corresponde a una ruta (para el botón Ayuda de cada pantalla). */
export function anclaAyuda(path) {
  if (path.startsWith('/app/postulaciones')) return 'clasificar';
  const g = GUIAS.filter((x) => x.ruta && x.ruta !== '/login' && (x.ruta === '/app' ? path === '/app' : path.startsWith(x.ruta.split('#')[0])))
    .sort((a, b) => b.ruta.split('#')[0].length - a.ruta.split('#')[0].length || a.ruta.includes('#') - b.ruta.includes('#'))[0];
  return g ? g.id : 'primeros-pasos';
}
