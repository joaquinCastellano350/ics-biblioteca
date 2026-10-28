# Catálogo público — SCRUM-13

`GET /api/books` es público y devuelve los libros sin exigir sesión. Acepta
`title` para coincidencia parcial sin distinguir mayúsculas ni tildes, y uno o
varios parámetros `subjectIds`. Si se reciben varias materias, alcanza con que
el libro tenga una de ellas (OR); cuando también hay un título, ambos criterios
se combinan (AND). Sin `subjectIds`, las materias no restringen el catálogo.
SCRUM-18 añade la disponibilidad en la misma respuesta, sin otra llamada HTTP
ni exigir sesión. Las acciones de préstamo y cola pertenecen a sus historias.

También acepta uno o varios `authorIds`: con varios, basta con que el libro
tenga cualquiera de esos autores (OR). Los criterios de título, autor y materia
activos se combinan entre sí (AND). Sin IDs de autor o materia, esos criterios
no restringen el catálogo.

`GET /api/subjects` es público e independiente de los resultados de libros.
Devuelve todas las materias de `subjects`, incluidas las que todavía no tienen
libros, ordenadas por nombre e ID. No pagina ni limita esa lista.

```json
{
  "books": [{
    "id": "UUID",
    "title": "Título",
    "authors": [{ "id": "UUID", "name": "Nombre" }],
    "subjects": [{ "id": "UUID", "name": "Materia" }],
    "availability": { "availableCopies": 2, "totalCopies": 5 }
  }]
}
```

La respuesta de materias es `{"subjects":[{"id":"UUID","name":"Materia"}]}`.
Una consulta combinada usa
`/api/books?title=redes&authorIds=UUIDA&subjectIds=UUID1&subjectIds=UUID2`.

Un catálogo vacío devuelve `{"books":[]}`. No se limita ni pagina la colección.
Cada libro aparece una vez; conserva todos los autores y materias con sus IDs,
incluidos autores homónimos. Libros, autores y materias se ordenan por título o
nombre y, como desempate, por ID. Las tarjetas recortan la presentación para no
desbordarse, pero conservan los metadatos completos recibidos. No abren detalle.

El controlador consulta Circulación una vez por lote para los libros del resultado
y solo expone los cupos disponibles y totales. No devuelve identidades ni estados
de préstamos, reservas o esperas. Si falla la disponibilidad o falta un conteo,
responde 503; no inventa cupos ni entrega una respuesta parcial.
Al recorrer WAITING en orden, persiste REJECTED_LIMIT y `closed_at` únicamente
cuando hay capacidad para atender el turno y el usuario tiene cinco préstamos.
Las esperas elegibles anteriores conservan la prioridad de esa capacidad. No se
crean reservas ni avisos y no se procesan cierres de vencimientos desde el GET.
El frontend muestra disponibles/total y grisa las tarjetas sin cupos, conservando
legibilidad y sin deshabilitar el contenedor. Consulta al entrar, recargar o
cambiar filtros; no consulta automáticamente ni agrega otro endpoint.
La acción de cola queda pendiente de SCRUM-23, según el alcance acordado.
Ver [persistencia y cálculo de disponibilidad](scrum-18-persistencia.md).

## Organización del backend

| Archivo en `backend/src/book/` | Responsabilidad |
| --- | --- |
| `book.ts` | Entidad `Book` con campos persistidos y proyección pública `CatalogBook`. |
| `book-repository-interface.ts` | Contrato de lectura independiente del ORM. |
| `book-repository.ts` | Consulta Prisma, selección de campos y relaciones ordenadas. |
| `book-controller.ts` | Preparación y lista explícita de campos de la respuesta pública. |
| `book-routes.ts` | Adaptación HTTP y error recuperable sin detalles de proveedores. |

`backend/src/subject/` contiene la lectura independiente de materias para el
desplegable. Una falla devuelve 503 con `SUBJECTS_UNAVAILABLE` y no expone
errores internos.

El repositorio recibe el PrismaClient compartido de database.ts; no abre pool adicional. La búsqueda de títulos usa SQL parametrizado para normalizar y comparar el título sin depender de title_search; Prisma carga después la proyección pública y sus relaciones. La proyección excluye los campos internos.

Una falla devuelve `503` con `error.code = CATALOG_UNAVAILABLE`; el frontend
ofrece reintentar. No sustituye un fallo por una colección vacía o datos de
demostración. No hay endpoints de escritura ni de detalle en esta historia.

## Modelo y migración

Se sigue el [modelo de Confluence v4](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762):
`books`, `authors`, `subjects`, `book_authors` y `book_subjects`. Los nombres de
autores no son únicos. Las relaciones tienen PK compuestas y el orden es
alfabético; no se introduce `display_order` de la propuesta local anterior.

`prisma/migrations/20261022000000_catalog/` contiene únicamente el esquema del
catálogo, incluidos FK, índices inversos y CHECK de `total_copies >= 0`.
El CHECK se mantiene en SQL porque no se expresa en el modelo Prisma.
No se carga bibliografía inicial ni se implementan cuentas o circulación.
El mínimo de un autor y una materia corresponde a la carga y a futuras
operaciones de escritura; la lectura no elimina libros existentes por ese motivo.

La migración no se aplica al arrancar. El 22/10/2026 se ejecutó `migrate deploy`
contra la rama `production` de Neon, después de incorporar y comprobar la
migración de cuentas del equipo. No se cargaron libros. Ver el
[registro de aplicación y verificación](migracion-catalogo-neon.md). Para futuras
aplicaciones, revisar el destino de `DATABASE_URL_UNPOOLED` y el historial completo.

## Integración y validación

Se conservan Express, readiness, Object Storage, configuración de entorno y
conexión a Neon del scaffolding actualizado. El despliegue aceptado usa un solo
servicio de Render: Express sirve Angular y `/api` con el mismo origen. Durante
desarrollo se mantiene el proxy de Angular al puerto 3000.

Las pruebas usan HTTP y Prisma con el adaptador pg conectado a PostgreSQL en
memoria mediante PGlite Socket. Ejecutan todas las migraciones versionadas en
orden, incluidos los modelos del equipo, y las consultas del repositorio.
Sus datos se crean solo en la base aislada de pruebas; no son una
carga inicial productiva ni una comprobación de la instancia real de Neon.

SCRUM-14/15/16 amplían los criterios de consulta; SCRUM-18 incorpora
disponibilidad y grisado; SCRUM-20/23 incorporarán las acciones autenticadas.
