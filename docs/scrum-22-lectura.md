# SCRUM-22 — Leer un libro prestado

## Alcance e integración

La [historia](https://joaquincastellano350.atlassian.net/browse/SCRUM-22), la
[épica de préstamos](https://joaquincastellano350.atlassian.net/browse/SCRUM-19)
y la [maqueta](referencias/biblioteca-digital-universitaria.html) ubican «Leer
online» en cada préstamo vigente de «Mis préstamos» y en el catálogo para los
libros ya prestados a esa cuenta; la confirmación ofrece «Empezar a leer».
El PDF se abre en otra pestaña. La aceptación de reservas aparece en «Mis préstamos» y desde el
enlace del correo; corresponde a SCRUM-26, pendiente.

SCRUM-22 implementa la autorización, la firma del acceso privado y el componente
de lectura, conectado al catálogo y a la confirmación de SCRUM-20. La integración
del botón en «Mis préstamos» también corresponde a SCRUM-22, pero espera a la
pantalla de SCRUM-21. No se agrega aquí otra lista ni una pantalla provisoria.
SCRUM-20 ya crea los préstamos en `develop`;
también se puede verificar la lectura con préstamos de prueba ya persistidos.

Revisión del 28/10/2026: SCRUM-21 está implementado en el
[PR #18](https://github.com/joaquinCastellano350/ics-biblioteca/pull/18), todavía
sin integrar a `develop`. Su lista usa `PersonalLoan.id`, compatible con la
entrada `loanId` del botón. Al integrarlo, se agrega `ReadBookButton` a los
imports de `LoansPage` y el botón dentro de cada `.loan-card`; también se ajusta
la prueba que actualmente exige que esas tarjetas no tengan acciones.
No hace falta consultar ni aceptar reservas para habilitar la lectura.

La consulta actual de Jira registra a SCRUM-20 como bloqueante de SCRUM-22.
Las dependencias de SCRUM-21 y SCRUM-25 pertenecen a SCRUM-26, cuya implementación
permanece pendiente. No se modificaron esos vínculos en Jira.

El [ADR](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/5177345)
y el [modelo, §§4 y 7](modelo-de-datos.md) exigen comprobar titularidad y vigencia
antes de emitir una URL firmada breve. Esta operación no crea préstamos, no
finaliza vencimientos, no reasigna cupos ni genera avisos. No necesita migraciones
ni datos iniciales nuevos. No implementa visor propio, lectura offline o protección
anticopia; el navegador puede permitir guardar una copia autorizada.

## Contrato de lectura

`GET /api/loans/readable`, protegido por sesión, entrega exclusivamente
`ownerId`, `serverTime` y `loans: [{ id, bookId, dueAt }]` de los préstamos vigentes
de esa cuenta. Es una consulta mínima para ubicar el botón en el catálogo; no
devuelve títulos, autores, esperas, posiciones, reservas ni claves del bucket.
El catálogo público conserva su contrato sin datos personales. La respuesta
privada usa `Cache-Control: no-store` y no se guarda en almacenamiento del navegador.

`CatalogReadingState`, limitado a la vida del catálogo, consulta al entrar,
autenticar o confirmar un préstamo. Cancela peticiones al cambiar de cuenta y
comprueba que `ownerId` coincida con la identidad que pidió los datos, incluso
si la cookie cambió antes de que terminara una revalidación de sesión. Un
temporizador retira los accesos al vencer, con referencia al reloj del servidor;
no hace polling, no cierra préstamos y no implementa SCRUM-27. Si falla la carga,
permite reintentar sin ocultar el catálogo público.

Una tarjeta con préstamo propio muestra «Leer online» aunque no queden cupos para
otras personas. Al conceder el préstamo, la confirmación muestra «Empezar a leer»
con el UUID recién recibido y actualiza las lecturas del catálogo. Ambos usan el
mismo componente y piden una firma nueva en cada clic.

`POST /api/loans/:loanId/read-access`, con cookie de sesión vigente y encabezado
`X-Biblioteca-Request: 1`. No recibe identificadores de usuario, claves del bucket
ni URLs en el cuerpo. `loanId` es el UUID del préstamo, no el del libro.

La API reutiliza `requireSession`. `LoanReadingRepository` consulta con Prisma únicamente
el préstamo de esa cuenta con `closed_at IS NULL` y
`started_at <= t < due_at`. Obtiene `t` del reloj de PostgreSQL; la única consulta
SQL directa es la lectura de ese reloj. Conserva los registros sin modificarlos.

`AppServices.loans` mantiene la concesión de SCRUM-20; `loanReading` inyecta la
consulta de lectura y `pdfAccess` su firmante. Los routers comparten `/api/loans`,
pero la autenticación de lectura se aplica solo a su ruta concreta, para no
interceptar la concesión ni cambiar su contrato de protección y análisis de JSON.

Respuesta `200` con `Cache-Control: no-store`:

```json
{
  "url": "https://almacenamiento.example/archivo.pdf?firma=temporal",
  "expiresAt": "2026-10-28T12:05:00.000Z"
}
```

`S3PdfAccessSigner` utiliza el cliente y bucket privados ya configurados. Firma un
`GetObject` con `application/pdf`, disposición `inline` y `private, no-store`.
La duración máxima elegida para esta implementación es **300 segundos**; también
se limita por `due_at`. La firma usa la referencia temporal de PostgreSQL y
redondea su vencimiento hacia abajo a segundos, como exige SigV4. Si no queda un
intervalo representable, no emite acceso. No se guardan URLs firmadas en la base
ni se agregan claves privadas al catálogo.

| Estado | Código | Comportamiento |
| --- | --- | --- |
| 400 | `INVALID_LOAN` | Identificador inválido. |
| 401 | `AUTH_REQUIRED` | Sesión ausente, vencida o revocada. |
| 403 | `REQUEST_NOT_ALLOWED` | Falta el encabezado de solicitud de la aplicación. |
| 404 | `LOAN_NOT_AVAILABLE` | Préstamo inexistente, ajeno, cerrado, aún no iniciado o vencido. No distingue datos ajenos. |
| 405 | `METHOD_NOT_ALLOWED` | Solo se admite POST para emitir accesos. |
| 503 | `READING_UNAVAILABLE` | Falló la consulta o la firma; no expone errores internos. |

Una URL ya emitida conserva su validez hasta su propio vencimiento; siempre
vence como máximo junto con el préstamo. Abrirla no consulta nuevamente la API.
No se promete revocar una copia ya obtenida ni un flujo de bytes ya iniciado.

## Incorporación en SCRUM-21

Importar `ReadBookButton` desde
`frontend/src/app/loans/read-book-button.ts` en el componente que presenta cada
préstamo vigente y agregar:

```html
<app-read-book-button [loanId]="loan.id" />
```

El botón usa PrimeNG y el tema común. Abre una pestaña durante el clic, elimina
`opener` y luego pide un acceso nuevo mediante `LoanReadingService` y
`AuthService.protectedRequest`. Solo navega al PDF si la respuesta sigue
perteneciendo a la sesión que inició la acción. No conserva la firma para futuros
clics. Si la autorización falla, cambia la cuenta o se destruye el componente,
se cierra la pestaña provisional. Si el navegador bloquea la pestaña, informa
cómo habilitarla sin pedir una firma innecesaria.

Un `401` permite iniciar sesión con el diálogo existente. Como en las demás
acciones protegidas, después del login la persona vuelve a pulsar «Leer online»;
no queda una lectura pendiente que pueda ejecutarse bajo otra cuenta.

## Verificación

- `backend/test/loan-reading.test.ts`: consultas Prisma sobre PostgreSQL en memoria
  con las migraciones reales; titularidad, préstamos vigentes/vencidos/cerrados/
  futuros, ausencia de escrituras, firma SigV4 y contrato HTTP protegido.
- `frontend/src/app/loans/read-book-button.spec.ts`: apertura y bloqueo de pestañas,
  doble clic, error de vigencia, reautenticación, cambio de cuenta, destrucción
  del componente y rechazo de protocolos distintos de HTTPS.
- `catalog-reading-state.spec.ts`: aislamiento entre cuentas, cancelación, errores,
  reintento y retiro de accesos vencidos sin escrituras.
- `frontend/e2e/reading.spec.ts`: lectura desde la confirmación y el catálogo,
  persistencia del acceso tras recargar, nueva pestaña sin `opener`, ausencia de
  duplicados y retiro al cerrar sesión, en escritorio, tablet y móvil.
- Verificación de solo lectura contra Neon y el bucket configurados: un préstamo
  de prueba existente permitió obtener un PDF real por rango (`206`, `%PDF-`,
  `application/pdf`, `inline`); sin firma respondió `403` y otra cuenta no obtuvo
  acceso. No se crearon préstamos, usuarios, sesiones ni objetos para esta prueba.

La prueba de navegación desde «Mis préstamos» queda pendiente de incorporar la
pantalla de SCRUM-21. Para probar ahora, autenticar al titular y usar «Leer online»
en el catálogo, o solicitar un libro disponible y pulsar «Empezar a leer» en la
confirmación. Recargar debe conservar los accesos propios y cerrar sesión debe
retirarlos. No se necesitan comandos de consola ni identificadores manuales.
