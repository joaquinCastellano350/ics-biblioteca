# Aplicación del catálogo a Neon — 22/10/2026

## Origen e integración

El proyecto es `odd-base-60911651`, rama `production`, según la vinculación local
del README. Las credenciales se descargaron a `.env.local`, excluido de Git.
La conexión pooled y la directa apuntan al mismo servidor y base.

Neon ya tenía `universities`, `users` y `sessions`, creadas mediante
`20261022170000_accounts_and_sessions`. Se incorporó su archivo SQL original de
la rama `HU-3-Inicio-Sesion`, commit `ff2b0310b3d991ff5f6e696b942d711ba1e3562f`,
y se integraron sus tres modelos en `schema.prisma`. El checksum del archivo
coincide con el registrado en `_prisma_migrations`; se comprobaron también las
columnas y restricciones de las tablas existentes. No se incorporó el seed ni
el resto de la implementación de autenticación de esa rama.

## Aplicación

`prisma validate` y la generación del cliente finalizaron correctamente. Pasaron
las siete pruebas del backend y su compilación. La prueba aislada aplica el
historial completo y consulta los modelos de cuentas y catálogo con Prisma.

`npm exec --workspace backend -- prisma migrate status` informó que la única
migración pendiente era `20261022000000_catalog`. Se ejecutó desde la raíz:

```sh
npm exec --workspace backend -- prisma migrate deploy
```

El comando terminó correctamente y aplicó únicamente esa migración. No se
ejecutaron resets, `db push`, seeds ni cambios de infraestructura con Neon CLI.
El catálogo tiene una fecha de migración anterior a cuentas, pero no depende de
esas tablas y ambos órdenes se admiten en este caso; no se renombró el historial.

## Resultado verificado

- Existen `books`, `authors`, `subjects`, `book_authors` y `book_subjects`.
- Se comprobaron las cinco PK, las cuatro FK y el CHECK de copias no negativas.
- Siguen presentes `universities`, `users` y `sessions`.
- Las dos migraciones figuran finalizadas, sin rollback, y sus checksums
  coinciden con los archivos locales.
- Una instancia temporal de Express con el repositorio Prisma y la conexión real
  a Neon respondió `GET /api/books` con HTTP 200 y `{"books":[]}`, sin sesión.
- En esa misma instancia, `GET /api/ready` respondió HTTP 200 con base y storage
  en estado `ok`. El chequeo de storage fue `HeadBucket`, sin escribir objetos.

No se cargaron libros ni se ejecutaron pruebas de escritura de datos sobre Neon.
Los datos usados por las pruebas automatizadas viven en PostgreSQL embebido y
se descartan al finalizar. La instancia HTTP de verificación se cerró al terminar;
este registro no acredita un despliegue en Render ni integra la UI de cuentas.
