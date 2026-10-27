# Contexto de circulación: préstamos, colas y reservas

Guía de entrada para desarrollar y revisar estas funcionalidades. Resume los
puntos que deben considerarse juntos; los contratos completos están en el
[modelo de datos](modelo-de-datos.md), secciones 4–8 y 10.

Fuente: [modelo de Confluence](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762),
versión 4, verificada el 27/10/2026, todavía en estado **DRAFT**, y los criterios
de las historias enlazadas abajo. Esta guía conserva ese estado y distingue las
reglas del modelo de su implementación e integración por historia.
Los términos se definen en [CONTEXT.md](../CONTEXT.md).

## Reglas que deben leerse juntas

| Tema | Regla | Fuente del modelo |
| --- | --- | --- |
| Préstamos | Duran 480 horas desde su concesión. Un estudiante puede tener hasta cinco vigentes. La vigencia exige `started_at <= t < due_at` y `closed_at IS NULL`; un préstamo vencido deja de ocupar cupo aunque su cierre siga pendiente. El MVP no incluye devolución anticipada ni renovación. | §§4–5 |
| Reservas | Un cupo asignado ocupa capacidad durante 24 horas desde la oferta efectiva. Solo `HELD` con `expires_at > t` ocupa cupo. Las reservas no cuentan como préstamos para el límite de cinco. | §§4–6 |
| Disponibilidad | Es `total_copies − préstamos vigentes − reservas vigentes`, después de atender la cola. Los cupos pendientes para ella no pueden concederse a quien la adelante. | §§5–6 |
| Entrada en cola | Se ordena por `order_seq`; solo puede existir una entrada abierta `WAITING`/`OFFERED` por estudiante y libro. Para entrar debe tener menos de cinco préstamos y no tener prestado ese libro. | §§3–5 y 7 |
| Rechazo al ofrecer turno | Cuando hay un cupo libre y le corresponde el turno a alguien con cinco préstamos, se cierra su entrada como `REJECTED_LIMIT`, se registra `closed_at` y el aviso por correo, y se considera inmediatamente a la siguiente persona. El rechazo es terminal; una nueva solicitud crea otra entrada al final. | §§4, 6 y 8; SCRUM-25 |
| Rechazo al aceptar reserva | Se comprueban otra vez titularidad, plazo y límite. Si tiene cinco préstamos, se cierran reserva y entrada como `REJECTED_LIMIT` y se reasigna el cupo, o queda libre si no hay nadie elegible. Esos cambios se confirman aunque la respuesta informe el rechazo. | §§4 y 7; SCRUM-26 |
| Aceptación válida | Reserva `CONSUMED`, entrada `FULFILLED` y préstamo vinculado se guardan juntos. El préstamo empieza al aceptar. La ocupación pasa de reserva a préstamo; abrir el enlace varias veces conserva el mismo resultado y no crea duplicados. | §§4 y 7 |
| Reloj y límites | PostgreSQL determina `t`. En `t = due_at` el préstamo ya venció; en `t = expires_at` la reserva ya no puede aceptarse. Las duraciones son horas transcurridas, independientes de la zona del navegador. | §§4 y 6 |
| Concurrencia | El modelo propone transacciones `SERIALIZABLE`, bloqueo por libro y reintentos completos y limitados. El límite del estudiante se valida también entre libros distintos; bloquear un solo libro no lo garantiza. | §§5–6 |
| Avisos y lectura | Los avisos se registran en un outbox dentro de la transacción; el envío ocurre después y conserva trabajo ante fallos. El aviso de turno requiere reserva vigente. Leer un PDF exige titularidad y préstamo vigente; la URL emitida no puede sobrevivir al préstamo. | §§7–8 |

## Conciliar antes de calcular

Según la sección 6, conciliar un libro comprende:

1. Cerrar préstamos vencidos y finalizar reservas vencidas junto con sus entradas.
2. Calcular capacidad libre y recorrer `WAITING` en orden mientras haya cupos.
3. Cerrar por límite a quien deba rechazarse al llegar su turno; para la primera
   persona elegible, crear reserva `HELD`, pasar su entrada a `OFFERED` y registrar
   el aviso. Continuar hasta agotar capacidad o cola.
4. Devolver la disponibilidad y las ofertas resultantes.

El modelo pide esta conciliación al procesar vencimientos y antes de conceder
préstamos, entrar o salir de colas o aceptar reservas. También al recargar el
catálogo o las esperas propias si hay vencimientos o cupos pendientes de asignar.

**Una proyección de lectura no sustituye esa conciliación.** Restar esperas
elegibles puede proteger temporalmente la prioridad de la cola, pero no crea una
reserva ni inicia sus 24 horas. Excluir una espera del conteo tampoco la cierra.
Las transiciones pertenecen a la operación transaccional de conciliación; un
filtro del cálculo de disponibilidad no es el lugar para añadir escrituras
aisladas. El rechazo por límite se evalúa al llegar el turno con capacidad libre,
no sobre todas las personas que esperan mientras el libro sigue sin cupos.

## Alcance y dependencias de las historias

| Historia | Responsabilidad relevante |
| --- | --- |
| [SCRUM-18](https://joaquincastellano350.atlassian.net/browse/SCRUM-18) | Mostrar disponibilidad y grisado, y actualizar al recargar. La integración con la conciliación debe distinguirse del cálculo de lectura. |
| [SCRUM-20](https://joaquincastellano350.atlassian.net/browse/SCRUM-20) | Conceder préstamos directos respetando capacidad, cola y límite del estudiante. |
| [SCRUM-23](https://joaquincastellano350.atlassian.net/browse/SCRUM-23) | Unirse a la cola e integrar su acción en la tarjeta grisada. |
| [SCRUM-25](https://joaquincastellano350.atlassian.net/browse/SCRUM-25) | Ofrecer turnos, rechazar por límite al llegar el turno, crear reservas y registrar avisos. |
| [SCRUM-26](https://joaquincastellano350.atlassian.net/browse/SCRUM-26) | Aceptar reservas y resolver el rechazo por límite con reasignación inmediata. |
| [SCRUM-27](https://joaquincastellano350.atlassian.net/browse/SCRUM-27) | Procesar vencimientos y su integración con la reasignación de cupos. |

En la revisión de la PR #13 se acordó que la acción de cola del AC de SCRUM-18
se integrará en SCRUM-23; su ausencia en esa PR queda como dependencia de esa
historia. Esto no declara implementada la acción ni cambia las reglas de turno.

Al trabajar en una entrega parcial, documentar qué regla se cumple, qué operación
queda pendiente y en qué historia se integrará. Contrastar esa división con los
AC vigentes. Una diferencia de integración con el modelo debe quedar explícita;
no se resuelve ampliando tácitamente una historia de lectura a toda circulación
ni declarando equivalente una proyección temporal al comportamiento completo.

## Escenarios que evitan omisiones

- **Salteado por límite:** un libro tiene un cupo libre y la primera persona
  tiene cinco préstamos. Conciliar cierra su entrada como `REJECTED_LIMIT` y
  atiende a la siguiente. Si luego vence uno de sus préstamos, la entrada cerrada
  conserva el rechazo; para volver a esperar necesita una nueva solicitud.
- **Cupo retenido sin oferta:** restar una entrada `WAITING` del conteo puede
  mostrar `0/1`, pero solo una reserva persistida tiene destinatario y plazo de
  aceptación de 24 horas. Verificar ambos efectos al integrar la conciliación.
- **Límite alcanzado después de la oferta:** rechazar al aceptar cierra reserva
  y entrada y reasigna inmediatamente. El rechazo no revierte esos cambios ni
  conserva la reserva hasta su vencimiento original.
- **Vencimiento sin proceso periódico:** préstamo o reserva vencidos no ocupan
  capacidad; si hay cola, la conciliación atiende primero a quienes esperan.
- **Concurrencia y reintentos:** dos solicitudes por el último cupo conceden un
  solo préstamo; dos libros solicitados con cuatro préstamos previos no permiten
  terminar con seis; aceptar dos veces una reserva produce un único préstamo.

Los escenarios completos, incluidos privacidad y fallos de correo, están en la
sección 10 del modelo. Seleccionar los aplicables al cambio y comprobar tanto
el resultado público como los estados persistidos de la operación implementada.
