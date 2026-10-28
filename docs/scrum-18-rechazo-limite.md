# SCRUM-18 — Rechazo por límite al llegar el turno

Corrección local acotada al comentario del PR #13. Sustituye la conciliación
completa introducida en `ea0c797`, que excedía este alcance.

La consulta lee préstamos y reservas vigentes con Prisma y el reloj de PostgreSQL.
Recorre WAITING por `order_seq` mientras haya capacidad, descontando de ella las
esperas elegibles anteriores. Cuando llega el turno de una entrada cuyo estudiante
tiene cinco préstamos, guarda REJECTED_LIMIT y `closed_at`. Esa es su única
escritura. El rechazo no se revierte si después baja la cantidad de préstamos.

Si no hay cupos, o las esperas anteriores ya tienen prioridad sobre ellos, no se
rechaza anticipadamente a nadie. Los libros se bloquean por ID ascendente y las
lecturas y rechazos confirman juntos en SERIALIZABLE, con reintentos limitados.
Las entidades y actualizaciones usan Prisma; el SQL se limita al bloqueo y reloj.

Se retiraron la creación de reservas HELD, los cambios a OFFERED, el procesamiento
de vencimientos, el registro/cancelación de avisos y las clases que los ejecutaban.
No hay nuevos endpoints. La asignación efectiva, los avisos y los cierres quedan
para sus historias, sin dar por implementada la conciliación completa del modelo.

La tabla `notification_outbox` y su migración ya aplicada se conservan como
historial de la versión anterior. No se utiliza ese modelo desde el flujo actual
ni se modifica la base remota para borrar datos o migraciones. La implementación
de notificaciones queda pendiente.

Las pruebas nuevas cubren la pérdida definitiva del lugar al pasar de cinco a
cuatro préstamos, la ausencia de rechazo prematuro, la prioridad de esperas
anteriores y rollback si falla la transacción. Las pruebas de disponibilidad
vuelven a comprobar que no se crean reservas ni se cierran registros vencidos.
