# Hotfix — búsquedas del catálogo

Rama `hotfix/catalogo-busquedas`, creada desde `develop` en `1929ccb`.
No tiene ticket de Jira. Esa base todavía no incluye la PR de SCRUM-18;
el hotfix no incorpora sus modelos ni su cálculo de disponibilidad.

## Corrección

Título y búsqueda interna de autores esperan 500 ms desde la última edición.
`switchMap` cancela inmediatamente el timer o la suscripción anterior cuando
llega una nueva edición: la respuesta anterior no sustituye los resultados
actuales durante la espera. Inicialización, limpiar, confirmar filtros y
reintentar permanecen inmediatos; sus eventos también anulan búsquedas pendientes.
Cerrar el menú de autores o salir del catálogo cancela su trabajo pendiente.

La barra conserva PrimeNG y usa CSS Grid: tres columnas iguales en escritorio,
título completo con dos filtros debajo en tablet y una columna en celular.
Ambos `p-select` ocupan todo el ancho de su columna, incluido el host de autores.

## Consultas y medición de latencia

Se midió el repositorio con lecturas secuenciales contra Neon el 26/10/2026,
registrando duración total y eventos de consultas de Prisma, sin cambiar datos.
Son muestras de este entorno, no una garantía de latencia ni una prueba de carga.

| Operación | Antes | Con relaciones `join` |
| --- | --- | --- |
| Catálogo sin filtros | 5 consultas; 2253 ms y 1908 ms | 1 consulta; 308 ms y 321 ms |
| Título «Redes» | 6 consultas; 919 ms | 2 consultas; 612 ms |
| Autores «a» | 1 consulta; 1012 ms | 1 consulta; 305 ms |
| Primer `SELECT 1` del proceso | 1769 ms | 2513 ms |

La reducción de consultas es un cambio de lógica confirmado. La diferencia de
tiempos también está afectada por calentamiento, conexión y variaciones de red:
la consulta de autores no cambió y sin embargo varió mucho. Un EXPLAIN de lectura
simple de books informó 0,029 ms de ejecución en PostgreSQL; no mide el endpoint
entero ni demuestra por sí solo el costo de la consulta con todas las relaciones.
No se reprodujeron los 5,2 segundos exactos reportados ni se identificó una causa
única para los 503. La cancelación del navegador no garantiza cancelar SQL que
el servidor ya recibió; reducir los envíos evita generar ese trabajo innecesario.

Se conserva Prisma: se habilita su opción Preview `relationJoins` y se solicita
`relationLoadStrategy: 'join'` en libros. No se agregan joins SQL escritos a mano,
otra conexión, caché ni cambios de hosting. Requiere regenerar el cliente Prisma;
los scripts habituales de build/test ya lo hacen. No cambia el esquema de Neon.

Referencias: [relaciones y estrategias de carga de Prisma](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries),
[RxJS debounceTime](https://rxjs.dev/api/index/function/debounceTime).
La implementación usa un timer dentro de switchMap para cancelar también las
respuestas anteriores inmediatamente, antes de que terminen los nuevos 500 ms.

## Verificación

- Pruebas del backend aprobadas, incluidas las consultas con Prisma/PGlite que
  conservan autores, materias, orden y filtros combinados.
- 177 pruebas de frontend aprobadas, con reloj controlado para los 499/500 ms,
  nuevas pulsaciones, cancelación inmediata, borrado, filtros y salida de página.
- Seis pruebas nuevas de navegador aprobadas en 1440, 768 y 320 px para el delay
  real de título/autores y los anchos de los tres controles.
- Build de ambos workspaces correcto. Frontend mantiene avisos de presupuesto:
  bundle inicial de 742,59 kB frente a 500 kB y CSS de catálogo de 7,74 kB frente a 4 kB.
- API local con Neon real: catálogo 200 en 1827 ms de TTFB en la primera llamada,
  título «Redes» 200 en 602 ms, autores «a» 200 en 307 ms y catálogo posterior 200
  en 206 ms. Estas muestras no constituyen una garantía de tiempo máximo.

No se modificaron datos ni se aplicaron migraciones durante este hotfix.

## Compatibilidad con SCRUM-18

Se simuló la combinación del hotfix con `feature/SCRUM-18-disponibilidad`
(`45c03fb`) mediante `git merge-tree`: no hubo conflictos. Se comprobó el árbol
combinado en una copia temporal, sin mover ni fusionar las ramas originales.
Pasaron 138 pruebas de backend, 178 de frontend, las compilaciones de ambos y
seis pruebas nuevas de navegador en escritorio, tablet y celular.

El fixture HTTP de las pruebas nuevas incluye `availability`, para ser compatible
tanto con la tarjeta de develop como con la de SCRUM-18. No fue necesario cambiar
las operaciones de disponibilidad ni los datos de Neon para esa comprobación.
