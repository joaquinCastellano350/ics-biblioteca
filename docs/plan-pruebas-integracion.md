# Plan de pruebas — landing, registro, login y Mis préstamos

Preparado el 24 de octubre de 2026 para `SCURM-6-integracion-landing_auth`.

Plan histórico de esa integración. Logout y vencimiento se integraron después; sus comprobaciones actuales se detallan en [los controles de release](release-sprint-1.md). Las exclusiones y los conteos de este plan corresponden al 24 de octubre y no certifican la versión candidata.

Publicado como [Test Plan en Confluence](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/10682369).
La página incluye los 45 casos y la siguiente etapa de automatización y trazabilidad por ID.

Este documento define qué comprobar y cómo registrar los resultados. Los casos
manuales comienzan **pendientes**: no se consideran aprobados por existir pruebas
automáticas o por haber compilado la aplicación.

## 1. Alcance y resultado esperado

Se verifica la integración entre `/`, `/catalogo`, `/registro` y `/prestamos`, la
cabecera compartida, el diálogo de login y la sesión de ambas historias.

En `/prestamos`, un visitante puede ver la presentación pública y los accesos de
cuenta. La sección autenticada solo aparece después de confirmar la sesión y
muestra «Estamos preparando esta sección». Todavía no hay listado, contador,
lectura, solicitud de préstamos, reservas ni operaciones de circulación.
Tampoco hay cierre de sesión en esta entrega. Estos pendientes no son fallos de
esta integración. El control visual de la pantalla no sustituye la autorización
que deberá implementar la futura API de préstamos.

Referencia de apariencia: [convenciones de UI](convenciones-ui.md) y
[HTML acordado](referencias/biblioteca-digital-universitaria.html).

## 2. Preparación

1. Usar esta rama y registrar también si se prueban cambios locales sin commit.
2. Tener frontend y backend del mismo código funcionando y un destino de datos
   de prueba identificado. Los registros manuales crean cuentas reales en ese
   destino. No hacen falta cambios de esquema para esta integración.
3. Si los servicios ya están configurados, iniciarlos en dos terminales desde la
   raíz del repositorio:

   ```sh
   npm run dev --workspace backend
   npm run dev --workspace frontend
   ```

4. Abrir la dirección que muestre el frontend, habitualmente
   `http://localhost:4200`. Mantener el mismo host durante cada recorrido:
   `localhost` y `127.0.0.1` no comparten cookies.
5. Preparar una cuenta existente **A** y correos nuevos para **B**, **C** y las
   pruebas de normalización. Ejemplo de nombre: `qa.integracion.<fecha>.<numero>@example.org`.
   Anotar las contraseñas exactas por separado; no adjuntarlas a la evidencia.
   Elegir una facultad real de la lista.
6. Usar una ventana normal para la sesión autenticada y un perfil o contexto
   privado independiente para el visitante. Las ventanas privadas del mismo
   navegador pueden compartir sesión entre sí; verificarlo antes de cada caso.
7. Para volver a visitante, eliminar la cookie `biblioteca_session` de ese origen
   desde las herramientas del navegador y **recargar**. Borrar la cookie no borra
   de inmediato el estado que la pestaña ya tenía en memoria.
8. Para los casos de red, abrir el panel de solicitudes, conservar el registro y
   usar demora o bloqueo selectivo. Una solicitud bloqueada prueba un fallo de
   transporte; no demuestra el comportamiento específico ante HTTP 503.
   Los 503 y las respuestas demoradas exactas se verifican con las fixtures de
   las pruebas automáticas si no hay un entorno que permita reproducirlos.
   Retirar los bloqueos antes de continuar con otros casos.

### Datos especiales

| Dato | Uso |
| --- | --- |
| Nombre `Ana`, apellido `Pérez` | Acentos y presentación de identidad. |
| Correo nuevo escrito con espacios exteriores y mayúsculas | Comprobar normalización y duplicados. |
| Correo de prueba con dominio internacional, por ejemplo `qa.<numero>@bücher.de` | Comprobar que registro y login aceptan el mismo formato. No se envía correo de confirmación. |
| Contraseña ` con espacios ñ 漢字 ` | Comprobar que ambos extremos conservan exactamente los espacios y caracteres. Es un dato exclusivo de prueba. |
| Nombre largo, por ejemplo 80 letras sin espacios | Comprobar la cabecera en celular después de autenticar. |

No asumir requisitos de ocho caracteres o combinación de símbolos: la regla
actual acepta una contraseña no vacía de hasta **1024 bytes UTF-8**. Nombre y
apellido compuestos solo por espacios son inválidos.

## 3. Recorrido mínimo antes de considerar el merge

Ejecutar estos diez pasos primero en escritorio y repetir el recorrido en un
celular o viewport de 320 px:

1. Como visitante, abrir `/`: ver landing y accesos de cuenta.
2. Abrir «Explorar catálogo»: ver el catálogo sin pedir login.
3. Abrir «Mis préstamos»: ver la invitación a ingresar, sin sección autenticada.
4. Pulsar «Ingresar a mi cuenta» y cancelar: conservar `/prestamos` y recuperar
   el foco en ese botón.
5. Volver a abrir, usar una contraseña incorrecta y después las credenciales de
   A: ver error primero y luego la sección en preparación, sin cambiar la ruta.
6. Recargar: conservar la cuenta A y la misma sección.
7. Eliminar la cookie y recargar: volver a la presentación de visitante.
8. Volver a la landing, abrir «Crear mi cuenta» y registrar B: llegar a `/` con
   «Hola, nombre», sin solicitar otro login.
9. Abrir `/prestamos` y recargar: conservar la sesión de B.
10. Volver a visitante e intentar registrar otra vez el correo de B: ver el error
    de correo ya registrado, conservando el formulario.

## 4. Casos funcionales completos

En las tablas, empezar como **visitante** salvo que se indique otra condición.
Cada fila se registra por separado como Aprobada, Fallida o Bloqueada.

### Navegación pública

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| NAV-01 | Abrir `/` y recorrer la landing. | Título, contenido, cabecera y pie presentes; sin login automático ni contenido de otra ruta. |
| NAV-02 | Usar «Explorar catálogo», «Ver el catálogo» y «Catálogo», volviendo al inicio entre intentos. | Todos abren `/catalogo`; el acceso es público. |
| NAV-03 | Abrir «Crear cuenta» en la cabecera y «Crear mi cuenta» en el hero, por separado. | Ambos abren `/registro`. «Volver al inicio» devuelve a la landing. |
| NAV-04 | Recorrer Inicio → Catálogo → Mis préstamos → Inicio y usar la marca. | Ruta y acceso activo correctos; la marca vuelve a `/`. No se duplican cabecera, pie o diálogo. |
| NAV-05 | Abrir directamente y recargar `/catalogo`, `/registro` y `/prestamos`. Probar también `/prestamos?origen=directo`. | Cada URL carga la pantalla correspondiente; no se pierde el query. En un despliegue, comprobar también el fallback del servidor, no solo Angular en desarrollo. |
| NAV-06 | Usar Atrás/Adelante y abrir `/ruta-inexistente`. | El historial permite volver entre pantallas. La ruta desconocida redirige a `/catalogo`. No se exige conservar un formulario de registro desmontado. |

### Registro

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| REG-01 | Registrar B con los cinco campos válidos. | Un POST de registro responde 201; vuelve a la landing con identidad visible. Desaparecen Ingresar, Crear cuenta y Crear mi cuenta. `/prestamos` reconoce la misma sesión. |
| REG-02 | Con facultades cargadas, enviar vacío; después probar nombre y apellido solo con espacios y omitir facultad. | Errores asociados a los campos. No se envía el POST hasta corregirlos. |
| REG-03 | Probar `sin-arroba`, `ana @example.org` y un correo válido no institucional. | Los inválidos muestran error; no se exige dominio universitario al válido. |
| REG-04 | Registrar un correo nuevo con mayúsculas y espacios exteriores; volver a visitante e intentar la misma dirección en minúsculas. | El primer registro normaliza el correo; el segundo devuelve 409 y «El correo electrónico ya está registrado». No crea otra cuenta ni inicia sesión como si hubiera tenido éxito. |
| REG-05 | Registrar C con la contraseña especial y el correo internacional; volver a visitante e ingresar con esos mismos datos. | Registro y login funcionan con los mismos datos. La contraseña no se recorta ni se transforma. Quitar un espacio de la contraseña produce error de credenciales. |
| REG-06 | Probar contraseña vacía y luego una de un carácter. | La vacía se rechaza. La de un carácter cumple la regla actual; no aparece una exigencia de complejidad adicional. |
| REG-07 | Demorar `/api/universities`; después provocar fallo y recuperar la conexión. | Se informa carga; no se puede enviar ni elegir una facultad mientras esté bloqueada. Ante fallo aparece reintento; al recuperar se carga la lista y se habilita el formulario. |
| REG-08 | Con fixture que devuelva cero universidades, abrir el registro y luego reconsultar. | Mensaje de lista vacía y opción de volver a consultar. No permite registrar ni inventa una facultad. |
| REG-09 | Demorar el POST de registro y pulsar dos veces el envío; en otro intento provocar fallo de red y reintentar tras recuperarla. | Un envío simultáneo como máximo; estado «Creando cuenta…». El fallo muestra error, conserva datos y libera el formulario. Si el servidor alcanzó a crear la cuenta antes de cortarse la respuesta, registrar esa incertidumbre y comprobar con login; no asumir rollback por un corte de red. |

### Inicio de sesión

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| LOG-01 | Abrir Ingresar desde landing, catálogo con query y registro con datos escritos; cancelar en cada pantalla. | Un único diálogo, sin navegar ni perder los datos de la página que sigue montada. Foco inicial en correo. |
| LOG-02 | Ingresar con A desde `/catalogo?q=algebra`. | Se cierra el diálogo, aparece la identidad y se conservan ruta, query, contenido y posición de la página. No se vuelve a pedir el catálogo por haber ingresado. |
| LOG-03 | Probar contraseña incorrecta y correo inexistente. Corregir después. | Mismo mensaje de credenciales incorrectas, sin revelar si existe la cuenta. El diálogo permanece abierto; el intento correcto funciona. |
| LOG-04 | Enviar campos vacíos y un correo inválido. | Validación de campos antes del POST; no navega ni cierra el diálogo. |
| LOG-05 | Cerrar por Cancelar, cruz y Escape; reabrir después de cada método. | Se limpia formulario, contraseña, errores y estado de mostrar contraseña; se devuelve el foco al disparador cuando siga presente. |
| LOG-06 | Usar Mostrar/Ocultar contraseña y enviar mediante Enter. | Cambia solo la visibilidad; conserva el valor exacto. Enter ejecuta un único envío válido. |
| LOG-07 | Demorar el login y pulsar varias veces Ingresar; después probar un fallo de red o 503 controlado. | Un POST simultáneo; estado de espera. Ante fallo no aparece una sesión nueva, se muestra un error recuperable y se puede reintentar. |
| LOG-08 | Demorar el login y cerrar el diálogo durante la espera. | Cierre posible, formulario limpio y bloqueo liberado; la respuesta cancelada no reabre el diálogo ni ejecuta navegación. No interpretar la cancelación del navegador como garantía de que el servidor no completó el login: una recarga debe consultar la sesión real. |

### Mis préstamos

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| PRE-01 | Como visitante, abrir desde la navegación y por URL directa. | «Mis préstamos» activo, invitación a ingresar y enlace Registrate; no aparece el texto de la sección autenticada. No abre automáticamente el diálogo. |
| PRE-02 | Abrir Ingresar a mi cuenta, cancelar y luego autenticar con A. | Cancelar conserva ruta y foco. El login correcto muestra la sección en preparación en `/prestamos`, sin segundo clic ni recarga. |
| PRE-03 | Con A autenticada, acceder desde landing y catálogo; recargar `/prestamos`. | Muestra la misma sección autenticada y la identidad. No muestra préstamos, cifras ni datos ficticios. |
| PRE-04 | Sin sesión, entrar a `/prestamos` con la consulta inicial de sesión demorada. | Indicador de comprobación. No aparecen fugazmente la sección autenticada ni el acceso central de visitante mientras el estado sea desconocido. |
| PRE-05 | Hacer fallar la comprobación inicial y luego pulsar Reintentar sesión con el servicio recuperado. | Estado «Tu sesión todavía no está confirmada», aviso de error y reintento. Un 503 no se presenta como un 401 ni abre login. Al recuperar, muestra el estado que realmente devuelva el servidor. |
| PRE-06 | Desde la invitación pública, usar Registrate y completar un alta nueva. Desde la sección autenticada, usar Explorar catálogo. | Registrate abre `/registro`; el éxito vuelve a la landing, según el flujo de registro. Explorar catálogo abre `/catalogo`. No se inventa un retorno de registro a préstamos. |

### Sesión y coherencia entre pantallas

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| SES-01 | Autenticar por registro y por login en recorridos independientes; navegar por todas las pantallas y recargar. | Una identidad compartida; no requiere otro ingreso al cambiar de pantalla ni pierde sesión al recargar mientras sea válida. |
| SES-02 | Con `/prestamos` abierto y sesión A, eliminar su cookie desde otra pestaña del mismo perfil y recuperar foco en la primera. | La revalidación recibe 401: desaparece la identidad y la sección autenticada; vuelve la invitación a ingresar sin cambiar `/prestamos`. No abre el diálogo por sí sola. |
| SES-03 | Con una sesión válida ya cargada, hacer fallar la revalidación por foco con red bloqueada o 503 controlado. | Conserva cuenta y sección con su vencimiento original. No trata la falla temporal como credenciales incorrectas ni prolonga la sesión. |
| SES-04 | Probar el límite de seis horas con el reloj simulado de las pruebas de AuthService. | Justo antes del límite sigue autenticada; al límite se limpia sesión y pasa a visitante sin renovar ni consultar de nuevo. La pantalla de préstamos responde a ese cambio. Adelantar solo el reloj del sistema o cambiar una cookie no demuestra este temporizador. |
| SES-05 | En dos pestañas del mismo perfil, cargar A; desde `/registro` en la segunda registrar otra cuenta B y luego recuperar foco en la primera. | La primera pestaña revalida y pasa a B, sin conservar la identidad de A. La actualización sucede al recuperar foco o recargar; no se exige sincronización instantánea entre pestañas. |
| SES-06 | En las pruebas automáticas, resolver un GET de sesión antiguo después de un login/registro correcto; repetir con 401 antiguo y con vencimiento de la cuenta anterior. | La respuesta anterior no borra ni reemplaza la sesión nueva. No se mezclan identidades ni se revive una sesión vencida. |
| SES-07 | En las pruebas automáticas, intentar login y registro simultáneos y generar eventos de foco durante el POST. | El bloqueo compartido evita otra mutación y revalidaciones que interfieran. Tras terminar o cancelar se puede volver a autenticar. |

### UI, teclado y adaptación

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| UI-01 | Revisar las cuatro rutas como visitante y con sesión, a 1440, 768 y 320 px. Incluir errores, nombre largo y facultad con nombre extenso. | Sin desplazamiento horizontal, textos cortados ni botones inaccesibles; paleta crema/verde, DM Sans, Manrope y controles PrimeNG coherentes con la referencia. |
| UI-02 | Usar solo Tab, Shift+Tab y Enter para recorrer navegación, registro y acceso a préstamos. | Orden utilizable, foco visible y etiquetas claras. Los botones deshabilitados no ejecutan acciones; los enlaces abren su destino. |
| UI-03 | Abrir el login por teclado y recorrerlo con Tab/Shift+Tab; cerrar con Escape. Repetir en 320 px. | Foco contenido en el diálogo, sin alcanzar controles del fondo; cierre accesible, devolución del foco y todos los controles alcanzables mediante desplazamiento. |
| UI-04 | En `/`, `/catalogo`, `/registro` y `/prestamos`, activar Saltar al contenido por teclado. | Enfoca el contenido principal actual y conserva la ruta y su query. |
| UI-05 | Seleccionar facultad con teclado y usar zoom de 200 %. | Opciones legibles y seleccionables; contenido y acciones siguen accesibles. El desplegable no queda recortado por el formulario. |
| UI-06 | Revisar títulos de pestaña, encabezados, errores y estados con el árbol de accesibilidad o lector de pantalla. | Cada ruta tiene título y encabezado principal identificables; campos tienen etiqueta, los errores se asocian a ellos y carga/errores se anuncian. El diálogo tiene nombre accesible. |

### Comprobaciones HTTP y almacenamiento

| ID | Pasos | Resultado esperado |
| --- | --- | --- |
| HTTP-01 | Inspeccionar un registro y un login reales en Red, y consultar sesión sin cookie. | Registro 201, login 200, consulta sin cookie 401. Los POST usan JSON y `X-Biblioteca-Request: 1`; no envían campos extras de sesión. Ninguna respuesta pública incluye token o hash de contraseña. |
| HTTP-02 | Revisar cookies y almacenamiento web tras autenticar. | `biblioteca_session` con HttpOnly, SameSite=Lax y Path=/; Secure en HTTPS de producción. Sin tokens ni DTO de sesión guardados por la aplicación en localStorage/sessionStorage. Respuestas de cuentas con `Cache-Control: no-store`. |
| HTTP-03 | En la suite de backend aislada, probar contraseña de 1024 y 1025 bytes, correos duplicados concurrentes, fallo de creación de sesión y marcador HTTP ausente. | Límite correcto de bytes, una sola cuenta por correo, rollback transaccional y rechazo de escritura sin marcador. El resultado no depende únicamente de validar el formulario. |

## 5. Verificación automática y evidencia previa

Desde la raíz, para una ejecución completa de regresión:

```sh
npm test
npm run build
npm run test:e2e --workspace frontend
```

- `npm test` ejecuta backend y frontend. La suite habitual de cuentas usa Prisma
  con PostgreSQL embebido PGlite; los casos específicos están en
  `backend/test/accounts-scenarios.ts`.
- AuthService cubre vencimiento, respuestas antiguas, revalidación y exclusión de
  escrituras en `frontend/src/app/auth/auth.service.spec.ts` y
  `auth.registration.spec.ts`.
- La composición de préstamos cubre carga, visitante, 401, 503 y reintento en
  `frontend/src/app/loans/loans-page.spec.ts`.
- Playwright ejecuta los casos en escritorio, tablet y celular. Usa respuestas
  API simuladas: verifica la interfaz y el protocolo del navegador; no prueba
  conjuntamente navegador, API y persistencia real. El recorrido manual inicial
  debe hacerse contra el backend real para cubrir esa unión.
- Playwright puede reutilizar un servidor en 4200. Antes de ejecutarlo, confirmar
  que corresponde a esta rama; alternativamente usar una configuración temporal
  con otro puerto y `reuseExistingServer: false`, como en la validación anterior.
- El perfil de PostgreSQL externo es opcional y requiere un destino nuevo y
  aislado. Sus instrucciones están en
  [integración de registro y login](integracion-hu02-hu03.md#postgresql-externo-aislado).

La última validación de **esta integración**, anterior a este plan, registró
**100 pruebas de Angular y 21 de navegador aprobadas**, sin omisiones, y build
de frontend correcto. Las capturas se generaron en
`node_modules/.cache/playwright-results/`. No se ejecutaron otra vez al redactar
este documento ni se atribuye a esta ejecución una validación nueva del backend.
El aviso conocido del bundle inicial es 735,43 kB frente al objetivo de 500 kB;
no impide compilar. Registrar cualquier error nuevo por separado.

## 6. Registro de resultados y criterio de salida

Para cada fila de los 45 casos funcionales, guardar:

| Campo | Completar al ejecutar |
| --- | --- |
| ID y resultado | Pendiente / Aprobada / Fallida / Bloqueada. |
| Código probado | Rama, commit y presencia de cambios locales. |
| Entorno | Frontend/API de desarrollo o despliegue; datos reales de prueba o fixtures. |
| Navegador y tamaño | Navegador/versión, escritorio/tablet/celular, viewport. |
| Evidencia | Pasos, esperado, observado y captura o código de respuesta cuando aporte información. |
| Incidencia | Referencia y alcance del fallo, si corresponde. No adjuntar contraseñas, cookies ni tokens. |

La integración queda lista para revisión final cuando:

- El recorrido mínimo pasa con API real en escritorio y celular.
- Los casos funcionales aplicables están aprobados; los bloqueados tienen una
  razón y una decisión explícita, sin contarlos como aprobados.
- La regresión automática pasa sobre el mismo código entregable.
- No hay mezcla de identidades, acceso visual autenticado antes de confirmar
  sesión, pérdida de sesión válida al navegar, envíos duplicados ni errores que
  impidan completar los recorridos.
- La interfaz mantiene las convenciones acordadas y es utilizable por teclado
  y a 320 px.
- Los pendientes de listado/operaciones de préstamos y logout quedan identificados
  como alcance futuro, sin presentarlos como funcionalidad ya probada.
