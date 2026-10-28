# Conciliación compartida — corrección del PR #13

El filtro anterior omitía temporalmente a quien tenía cinco préstamos, pero
conservaba su entrada WAITING. Al vencer un préstamo, recuperaba un lugar que
debía haber perdido. La corrección persiste la decisión al llegar su turno.

## Operación y alcance

`CirculationRepository.findOccupancy` ejecuta `CirculationReconciler.reconcile`
en una transacción SERIALIZABLE. El helper recibe la transacción del llamador,
por lo que las futuras operaciones pueden reutilizarlo sin abrir otra.

1. Bloquear todos los libros solicitados por ID ascendente y obtener el reloj
   de PostgreSQL después de los bloqueos.
2. Cerrar préstamos vencidos; pasar reservas y entradas ofrecidas vencidas a
   EXPIRED. Cancelar los avisos de turno todavía PENDING de esas reservas.
3. Calcular ocupación y recorrer WAITING por orden de ingreso solo mientras haya
   cupos. No evaluar ni rechazar anticipadamente a quienes aún no tienen turno.
4. Con cinco préstamos vigentes, guardar REJECTED_LIMIT y `closed_at`, registrar
   QUEUE_LIMIT_REJECTED y continuar sin consumir un cupo. El rechazo es terminal.
5. Para una persona elegible, guardar OFFERED, crear una reserva HELD por 24 horas
   y registrar TURN_AVAILABLE. Recalcular el cupo a partir de reservas reales.

Reclamar la entrada antes de insertar la reserva permite que PostgreSQL detecte
una instantánea vieja como conflicto de serialización durante recargas concurrentes.
Todas las transiciones son invisibles hasta el COMMIT. Si falla el aviso o cualquier
otro paso, se revierten también los cierres, el rechazo y la reserva. Se reintenta
la transacción completa hasta tres veces ante serialización o interbloqueo.

Los conteos se obtienen por lote con relaciones Prisma. El SQL explícito se limita
a FOR UPDATE y al reloj; las actualizaciones y creaciones utilizan el ORM.
La respuesta pública conserva solo metadatos y disponibles/total, sin destinatarios,
esperas, estados internos ni datos del outbox.

`NotificationOutboxRepository` solo encola dos avisos necesarios para esta operación.
El esquema del outbox sigue Confluence y conserva las columnas para recuperación y
reintentos de la futura entrega. No hay proveedor de correo, worker, cron ni nuevos
endpoints de préstamos, cola o aceptación. La lectura de PDF sigue fuera del alcance.
Las futuras operaciones de SCRUM-20/23/25/26/27 deben reutilizar la conciliación,
los bloqueos y las transacciones; no implementar otra atención de cola independiente.

## Validación

La regresión verifica que REJECTED_LIMIT no vuelva a WAITING al pasar de cinco a
cuatro préstamos; también comprueba FIFO, ausencia de rechazo prematuro, reservas
y avisos únicos, rollback ante fallo del outbox y reintentos limitados.
El outbox valida origen, tipo, estado y campos de procesamiento en PostgreSQL.
Las pruebas aisladas usan UTC para no reinterpretar fechas con la zona de Windows.

La prueba optativa de concurrencia usa PostgreSQL externo y conexiones independientes:

```powershell
$env:CIRCULATION_TEST_DATABASE_URL = '<conexión de una base aislada nueva>'
$env:CIRCULATION_ALLOW_INTEGRATION_WRITES = '1'
npm run test:circulation:integration --workspace backend
```

Exige una base llamada `ics_circulation_test`, vacía, y no carga dotenv ni la
conexión habitual de la API. Rechaza una base ya inicializada antes de escribir.
Debe descartarse el destino de pruebas después de la ejecución. Verifica tres
recargas simultáneas del último cupo, IDs de libros en orden invertido y persistencia
del rechazo en PostgreSQL real. No necesita Docker ni usa datos de producción.

Para esta corrección se ejecutó en una rama Neon temporal creada solo con esquema,
con una base nueva y fecha de expiración. La prueba en memoria no se presenta como
evidencia suficiente de concurrencia entre conexiones PostgreSQL independientes.

## Resultado de la corrección — 27/10/2026

- 148 pruebas de backend aprobadas y compilación correcta.
- Cuatro pruebas (incluido el caso contenedor) aprobadas en PostgreSQL externo,
  con conexiones independientes. La rama temporal de Neon y su base de prueba
  se eliminaron al terminar.
- La nueva migración se aplicó a `production`, base `neondb`, a las 00:44:26 UTC
  del 28/10 (21:44:26 de Argentina del 27/10). Prisma informa el historial al día
  y el checksum coincide con el archivo local. No se editaron migraciones previas.
- `GET /api/books` real respondió 200 en dos consultas consecutivas. La primera
  concilió los datos manuales existentes; al repetir, el outbox permaneció en un
  aviso PENDING y cero SENT. No se creó un segundo aviso ni se envió correo.

El frontend y el DTO público no cambian en esta corrección. La comprobación del
rechazo y su persistencia se hace en pruebas aisladas, sin crear cuentas ni
préstamos adicionales en la base de producción.
