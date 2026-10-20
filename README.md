# Biblioteca Digital Universitaria

Biblioteca universitaria con catálogo público y préstamos digitales de duración limitada para estudiantes registrados.

## Organización

Monorepo administrado con npm workspaces:

```text
ICS-Biblioteca/
├── frontend/          # Interfaz web: @ics-biblioteca/frontend
│   ├── src/
│   └── package.json
├── backend/           # API y reglas de negocio: @ics-biblioteca/backend
│   ├── src/
│   └── package.json
├── docs/              # Documentación y modelo de datos
├── CONTEXT.md         # Vocabulario del dominio
├── package.json       # Configuración de los workspaces
└── package-lock.json  # Resolución de dependencias de todo el repositorio
```

Cada aplicación mantiene sus dependencias en su propio `package.json`. La instalación se administra desde la raíz, con un único `package-lock.json`. Las aplicaciones pueden compilarse y desplegarse por separado.

## Preparación

Usar Node.js 24 y npm 11 o superior. El archivo `.nvmrc` indica la versión de Node para quienes usen un gestor compatible.

Desde la raíz del repositorio:

```sh
npm ci
npm ls --workspaces --depth=0
```

El segundo comando debe mostrar `@ics-biblioteca/frontend` y `@ics-biblioteca/backend` vinculados a sus carpetas locales.

## Agregar dependencias

Ejecutar estos comandos desde la raíz, reemplazando `nombre-del-paquete` por la dependencia elegida:

```sh
npm install nombre-del-paquete --workspace frontend
npm install nombre-del-paquete --workspace backend
```

Para una dependencia de desarrollo de una aplicación, agregar `--save-dev`. Para herramientas compartidas del repositorio, usar `npm install --save-dev nombre-del-paquete` desde la raíz, sin seleccionar un workspace.

Versionar los cambios del `package.json` correspondiente junto con el `package-lock.json` de la raíz.

## Estado inicial

El scaffolding define los dos paquetes y sus carpetas de código. La elección de frameworks y la configuración de los comandos `dev`, `build` y `test` corresponden al siguiente paso; todavía no hay aplicaciones ejecutables ni pruebas configuradas.

Cuando una aplicación incorpore sus scripts, se podrán ejecutar desde la raíz con `npm run dev --workspace frontend` o `npm run dev --workspace backend`, por ejemplo. Para ejecutar un script en ambas, usar `npm run build --workspaces` una vez que ambas lo definan.

Las reglas de cupos, préstamos, reservas y vencimientos pertenecen al backend. La integración con el frontend se realizará mediante un contrato de API explícito.

## Documentación

- [Vocabulario del dominio](CONTEXT.md).
- [Propuesta de modelo de datos](docs/modelo-de-datos.md).
- [Diagrama del modelo](docs/modelo-de-datos.mmd).
