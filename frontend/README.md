# Frontend

Workspace `@ics-biblioteca/frontend`: Angular 22, componentes standalone,
PrimeNG 22, routing y salida estática. Conserva el tema `bibliotecaTheme` y las
fuentes incorporadas en el scaffolding del equipo. El catálogo público de
SCRUM-13 usa tarjetas, botones y estados de carga de PrimeNG.

Usar Node.js 24.15 o superior dentro de la rama 24 y npm 11 o superior. Instalar las dependencias desde la raíz con `npm ci`; se conserva un único lockfile para ambos workspaces.

Comandos desde la raíz:

```sh
npm run dev --workspace frontend
npm run build --workspace frontend
npm test --workspace frontend
npm run test:watch --workspace frontend
npm run test:e2e --workspace frontend
```

El servidor de desarrollo muestra su dirección local en la consola. Las pruebas usan Vitest y jsdom, incluidos por Angular CLI, sin requerir instalar un navegador.

Las pruebas de interfaz con Playwright usan Chrome instalado y arrancan Angular
en `127.0.0.1:4200`. Si se usa Chromium de Playwright, instalarlo con
`npx playwright install chromium` y ejecutar con `PLAYWRIGHT_CHANNEL=chromium`.
Verifican la landing, navegación, metadatos largos y estados del catálogo en
escritorio, tablet y celular. Las capturas se guardan en `test-results/`.
Los accesos personales permanecen deshabilitados hasta integrar las historias
del equipo; no se crean pantallas ni diálogos de placeholder. Véase
[landing e integración](../docs/landing-integracion.md).

En desarrollo, Angular escucha en el puerto 4200 y `proxy.conf.json` reenvía `/api/**` a Express en `http://127.0.0.1:3000`, conservando la ruta completa. Por ejemplo, `/api/ready` llega a la misma ruta de la API. Iniciar Express en otra terminal con `npm run dev --workspace backend`.

El proxy solo existe en `ng serve`. En Render, Express sirve Angular y la API
bajo un único origen HTTPS según el ADR actualizado, conservando llamadas
relativas a `/api`. Ninguna credencial de Neon se incorpora al frontend.

La raíz fija Vite 8.3.3 para `@angular/build` mediante un `override`: Angular CLI 22.2.3 incluye Vite 8.3.0, afectado por avisos de seguridad corregidos en ese parche. Revisar este override cuando Angular actualice su dependencia de Vite. Referencia: [aviso GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm).

El build genera los archivos estáticos en `frontend/dist/biblioteca/browser/`.
El servidor Express detecta ese directorio y resuelve las rutas de Angular con
`index.html`, manteniendo los 404 de la API separados.

Administrar nuevas dependencias desde la raíz siguiendo el [README del repositorio](../README.md).
