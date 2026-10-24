# Catálogo público — SCRUM-13

`GET /api/books` es público y devuelve todos los libros sin exigir sesión.
No implementa búsqueda, filtros, disponibilidad ni acciones de circulación.

```json
{
  "books": [{
    "id": "UUID",
    "title": "Título",
    "authors": [{ "id": "UUID", "name": "Nombre" }],
    "subjects": [{ "id": "UUID", "name": "Materia" }]
  }]
}
```

Un catálogo vacío devuelve `{"books":[]}`. No se limita ni pagina la colección.
Cada libro aparece una vez; conserva todos los autores y materias con sus IDs,
incluidos autores homónimos. Libros, autores y materias se ordenan por título o
nombre y, como desempate, por ID. Las tarjetas recortan la presentación para no
desbordarse, pero conservan los metadatos completos recibidos. No abren detalle.

## Organización del backend

| Archivo en `backend/src/book/` | Responsabilidad |
| --- | --- |
| `book.ts` | Entidad `Book` con campos persistidos y proyección pública `CatalogBook`. |
| `book-repository-interface.ts` | Contrato de lectura independiente del ORM. |
| `book-repository.ts` | Consulta Prisma, selección de campos y relaciones ordenadas. |
| `book-controller.ts` | Preparación y lista explícita de campos de la respuesta pública. |
| `book-routes.ts` | Adaptación HTTP y error recuperable sin detalles de proveedores. |

El repositorio recibe el PrismaClient compartido de `database.ts`; no abre un
pool adicional ni usa SQL manual para consultar libros. La entidad contiene
`titleSearch`, `pdfObjectKey`, `totalCopies` y `createdAt`, con el mapeo a los
nombres SQL del modelo. La proyección pública excluye esos campos internos.
`select` evita traer la clave del PDF desde la base para esta consulta.

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

SCRUM-14/15/16/17 ampliarán los criterios de consulta; SCRUM-18 incorporará
disponibilidad y grisado; SCRUM-20/23 incorporarán las acciones autenticadas.
