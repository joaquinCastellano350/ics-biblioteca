# SCRUM-18 — Prueba manual con Neon

Preparación realizada el 26/10/2026 sobre `production`, base `neondb`.
Se usaron tres usuarios existentes, sin cambiar sus cuentas ni crear otros.
Inicialmente se agregaron cuatro préstamos, tres reservas y cuatro entradas en cola.
Los IDs de los registros creados quedaron guardados localmente en
`%TEMP%/ics-biblioteca-scrum18-fixtures.json` para poder identificarlos después.
Estos registros son escenarios manuales, no un seed que se ejecute al arrancar.

Los préstamos vigentes terminan unos veinte días después de la preparación.
Las reservas inicialmente vigentes terminan unas veintitrés horas después; los resultados
de la tabla corresponden al momento de preparación y cambiarán al vencer.
El préstamo vencido y la reserva vencida se dejaron sin procesar su cierre
para comprobar que el conteo respeta las fechas sin depender de un proceso periódico.

## Servicios locales

- Frontend: <http://127.0.0.1:4200/catalogo>
- Backend: <http://127.0.0.1:3000/api/books>
- Readiness: <http://127.0.0.1:3000/api/ready>

El frontend usa la API real a través del proxy `/api`, sin interceptaciones ni
respuestas simuladas. Los servicios se levantaron con los scripts `dev` de ambos
workspaces. No se necesita iniciar sesión para probar disponibilidad.

## Casos y resultados esperados

| Caso | Pasos | Resultado esperado |
| --- | --- | --- |
| Catálogo público | Abrir el catálogo como visitante. | Cinco tarjetas con título, autores, materias y disponibilidad; sin exigir login. |
| Último cupo prestado | Localizar «Análisis de sistemas y señales con cómputo avanzado». | `0/1`, tarjeta grisada; texto legible. Hay un préstamo vigente. |
| Recarga y cupos agotados | Localizar «Data and Computer Communications». | Estado final `0/2`, grisado, por dos préstamos vigentes. Durante la prueba primero mostraba `1/2` por una reserva; ver los cambios controlados más abajo. |
| Préstamo más reserva | Localizar «Kanban». | `1/3`: un préstamo vigente y una reserva vigente ocupan dos cupos. |
| Fechas vencidas | Localizar «Redes de computadoras». | `4/4`: el préstamo vencido sin cerrar y la reserva HELD vencida no descuentan cupos. |
| Prioridad de espera | Localizar «Software Engineering: A Practitioner's Approach». | `3/5`: un préstamo vigente y un cupo pendiente para una espera WAITING elegible. La lectura no crea la reserva ni cambia la espera. |
| Búsqueda y filtros | Buscar «Kanban»; aplicar un autor y una materia presentes en su tarjeta. | Solo devuelve resultados compatibles; Kanban mantiene `1/3`. Limpiar los filtros restaura los cinco libros y sus conteos. |
| Recarga | Pulsar F5 y comparar con `GET /api/books`. | Conteos y grisado coinciden con la respuesta actual. Sin cambios en DB deben mantenerse los valores; no aparecen cupos inventados. |
| Una respuesta de libros | En las herramientas del navegador, abrir Red, limpiar el registro y recargar. | Una llamada a `/api/books` contiene metadatos y `availability` de todos los libros. No hay llamada separada a `/api/availability`. Las consultas de sesión y materias son independientes y esperadas. |
| Celular y teclado | Probar a 320 px y recorrer navegación y filtros con Tab. | Conteos legibles y sin desbordamiento horizontal; el grisado no deshabilita el contenedor de la tarjeta. |

La acción de unirse a la cola queda pendiente de SCRUM-23. Las operaciones de
solicitar préstamos, aceptar reservas, leer PDFs y listar préstamos personales
no se consideran implementadas por esta prueba de disponibilidad.

La entrega automática de turnos y notificaciones tampoco se activa: los estados
se prepararon directamente con Prisma, manteniendo las relaciones y las duraciones
de la base. Si se repiten estos escenarios otro día, revisar fechas y datos antes
de asumir que siguen vigentes los mismos resultados.

## Cambios controlados durante la prueba de recarga

A pedido del usuario se cancelaron la reserva de prueba y su entrada en cola de
«Data and Computer Communications», conservando ambos registros con estado
`CANCELLED` y su fecha de cierre. Eso dejó el libro en `2/2`.
Luego se crearon dos préstamos vigentes, para dos usuarios existentes distintos,
y el conteo pasó a `0/2`. Los cupos totales permanecieron en dos.
Estas dos modificaciones se verificaron desde el backend sin recargar ni tocar
la página del usuario; el usuario realizó la recarga y confirmó el funcionamiento.

El conjunto final contiene seis préstamos, tres reservas y cuatro entradas en
cola; incluye los registros vencidos y cancelados conservados para las pruebas.
Los otros cuatro libros mantienen los resultados de la tabla mientras no venzan
sus ocupaciones. El manifiesto local también registra los cambios y los IDs de
los dos préstamos adicionales.
