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
de lectura, conectado al catálogo, a la confirmación de SCRUM-20 y a cada préstamo
vigente de «Mis préstamos». Reutiliza la pantalla y la consulta de SCRUM-21;
no se agrega otra lista ni una pantalla provisoria.
SCRUM-20 ya crea los préstamos en `develop`;
también se puede verificar la lectura con préstamos de prueba ya persistidos.

SCRUM-21 se integró a `develop` mediante el
[PR #18](https://github.com/joaquinCastellano350/ics-biblioteca/pull/18), commit
`cfbe60a`. La rama de SCRUM-22 fue rebasada sobre esa base. `LoansPage` incorpora
`ReadBookButton` en cada `.loan-card`, usando `PersonalLoan.id`. Un rechazo de
lectura por vigencia actualiza la lista mediante la consulta existente.
Las reservas y esperas conservan su comportamiento de SCRUM-21, sin acciones de
aceptación, cancelación o reasignación añadidas por esta historia.

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

Catálogo y «Mis préstamos» reutilizan `LoanQueryService` y el endpoint protegido
`GET /api/me/circulation` de SCRUM-21. El catálogo convierte únicamente los
préstamos vigentes en un mapa `book.id → loan.id` para ubicar los botones. Se
conservan las restricciones de solicitud por préstamo existente, espera, reserva,
cinco préstamos o comprobación pendiente; tener cinco préstamos no impide leer
uno propio vigente. La disponibilidad pública no incorpora datos personales.

Se eliminaron el endpoint provisional `GET /api/loans/readable`, su consulta
Prisma y `CatalogReadingState`: ya no se necesitan dos consultas ni dos estados
para los mismos préstamos. Se conservan la invalidación entre cuentas, el reloj
del servidor y el manejo de errores del servicio compartido. La API de lectura
vuelve a comprobar titularidad y vigencia en cada clic, independientemente de la
instantánea de interfaz. No se agregan cierres, procesos periódicos ni migraciones.

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
- `loans-page.spec.ts` y `catalog-page.spec.ts`: integración del botón con la
  consulta compartida, ausencia de solicitud duplicada y actualización ante un
  préstamo que ya no está vigente. Se conservan las pruebas de sesión, cuenta y
  vencimientos de SCRUM-21.
- `frontend/e2e/reading.spec.ts`: lectura desde confirmación, catálogo y «Mis préstamos»,
  persistencia del acceso tras recargar, nueva pestaña sin `opener`, ausencia de
  duplicados y retiro al cerrar sesión, en escritorio, tablet y móvil.
- Verificación de solo lectura contra Neon y el bucket configurados: un préstamo
  de prueba existente permitió obtener un PDF real por rango (`206`, `%PDF-`,
  `application/pdf`, `inline`); sin firma respondió `403` y otra cuenta no obtuvo
  acceso. No se crearon préstamos, usuarios, sesiones ni objetos para esta prueba.

Para probar, autenticar al titular y usar «Leer online» en el catálogo o en
«Mis préstamos», o solicitar un libro disponible y pulsar «Empezar a leer» en la
confirmación. Recargar debe conservar los accesos propios y cerrar sesión debe
retirarlos. No se necesitan comandos de consola ni identificadores manuales.
