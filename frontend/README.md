# Frontend

Workspace `@ics-biblioteca/frontend`: Angular 22, componentes standalone, routing, CSS y salida estática. La pantalla inicial es la bienvenida generada por Angular CLI; todavía no implementa historias de usuario.

Usar Node.js 24.15 o superior dentro de la rama 24 y npm 11 o superior. Instalar las dependencias desde la raíz con `npm ci`; se conserva un único lockfile para ambos workspaces.

Comandos desde la raíz:

```sh
npm run dev --workspace frontend
npm run build --workspace frontend
npm test --workspace frontend
npm run test:watch --workspace frontend
```

El servidor de desarrollo muestra su dirección local en la consola. Las pruebas usan Vitest y jsdom, incluidos por Angular CLI, sin requerir instalar un navegador.

En desarrollo, Angular escucha en el puerto 4200 y `proxy.conf.json` reenvía `/api/**` a Express en `http://127.0.0.1:3000`, conservando la ruta completa. Por ejemplo, `/api/ready` llega a la misma ruta de la API. Iniciar Express en otra terminal con `npm run dev --workspace backend`.

El proxy solo existe en `ng serve`: no forma parte de la salida estática. Al desplegar en Render deberá configurarse la URL pública de la API y su política CORS según los dominios elegidos. Ninguna credencial de Neon se incorpora al frontend.

La raíz fija Vite 8.3.3 para `@angular/build` mediante un `override`: Angular CLI 22.2.3 incluye Vite 8.3.0, afectado por avisos de seguridad corregidos en ese parche. Revisar este override cuando Angular actualice su dependencia de Vite. Referencia: [aviso GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm).

El build de producción genera los archivos estáticos en `frontend/dist/biblioteca/browser/`. Para el despliegue en Render, configurar esa carpeta como directorio de publicación y una reescritura de las rutas de la aplicación hacia `/index.html`.

Administrar nuevas dependencias desde la raíz siguiendo el [README del repositorio](../README.md).
