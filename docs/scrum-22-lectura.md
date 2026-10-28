# SCRUM-22 — Leer un libro prestado

## Alcance e integración

La [historia](https://joaquincastellano350.atlassian.net/browse/SCRUM-22), la
[épica de préstamos](https://joaquincastellano350.atlassian.net/browse/SCRUM-19)
y la [maqueta](referencias/biblioteca-digital-universitaria.html) ubican «Leer
online» en cada préstamo vigente de «Mis préstamos». El PDF se abre en otra
pestaña. La aceptación de reservas aparece en esa misma pantalla y desde el
enlace del correo; corresponde a SCRUM-26, pendiente.

Por el acuerdo de alcance de esta entrega, SCRUM-22 implementa la autorización,
la firma del acceso privado y el componente reutilizable. SCRUM-21 consultará y
mostrará las listas propias e incorporará el componente; no se agrega aquí otra
lista ni una pantalla provisoria. SCRUM-20 creará los préstamos. Mientras tanto,
se puede verificar la lectura con préstamos de prueba ya persistidos.

El [ADR](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/5177345)
y el [modelo, §§4 y 7](modelo-de-datos.md) exigen comprobar titularidad y vigencia
antes de emitir una URL firmada breve. Esta operación no crea préstamos, no
finaliza vencimientos, no reasigna cupos ni genera avisos. No necesita migraciones
ni datos iniciales nuevos. No implementa visor propio, lectura offline o protección
anticopia; el navegador puede permitir guardar una copia autorizada.

## Contrato de lectura

`POST /api/loans/:loanId/read-access`, con cookie de sesión vigente y encabezado
`X-Biblioteca-Request: 1`. No recibe identificadores de usuario, claves del bucket
ni URLs en el cuerpo. `loanId` es el UUID del préstamo, no el del libro.

La API reutiliza `requireSession`. `LoanReadingRepository` consulta con Prisma únicamente
el préstamo de esa cuenta con `closed_at IS NULL` y
`started_at <= t < due_at`. Obtiene `t` del reloj de PostgreSQL; la única consulta
SQL directa es la lectura de ese reloj. Conserva los registros sin modificarlos.

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
- Verificación de solo lectura contra Neon y el bucket configurados: un préstamo
  de prueba existente permitió obtener un PDF real por rango (`206`, `%PDF-`,
  `application/pdf`, `inline`); sin firma respondió `403` y otra cuenta no obtuvo
  acceso. No se crearon préstamos, usuarios, sesiones ni objetos para esta prueba.

La prueba de navegación completa desde «Mis préstamos» queda pendiente de la
integración de SCRUM-21. Para probar manualmente el botón antes de esa integración,
se lo puede montar en un host de pruebas Angular con un `loanId` válido, autenticar
al titular y pulsarlo; no hace falta implementar SCRUM-20 ni incorporar ese host
a las rutas productivas.
