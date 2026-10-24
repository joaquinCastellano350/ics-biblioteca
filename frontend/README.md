# Frontend

Workspace `@ics-biblioteca/frontend`: Angular 22, componentes standalone, PrimeNG 22, routing, CSS y salida estática. Implementa el catálogo público de SCRUM-13, el registro de SCRUM-7 y el diálogo de login de SCRUM-8. Conserva el tema `bibliotecaTheme` y las fuentes del equipo. La landing y la composición visual final del encabezado, navegación y footer pertenecen a SCRUM-6.

Las convenciones visuales fijas están en [Convenciones de UI](../docs/convenciones-ui.md): usar PrimeNG y mantener los estilos de la referencia HTML compartida.

Se acordó mantener Angular 22 y PrimeNG 22 con licencia Community. La clave proporcionada por Joaquín está configurada en el campo `license` de `providePrimeNG`, en `src/app/app.config.ts`, y se verificó en navegador que el aviso de licencia desaparece. La clave vence el 22 de octubre de 2027. La activación no requiere cambiar el backend ni los proveedores de hosting. Ver las instrucciones y referencias en las convenciones de UI.

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

El proxy solo existe en `ng serve`: no forma parte de la salida estática. En `NODE_ENV=production`, Express sirve el build de Angular y `/api` bajo el mismo origen HTTPS, según el [ADR-0002](../docs/adr/0002-sesion-y-origen-web.md). El [contrato](../docs/contrato-autenticacion.md) usa rutas relativas y cookie HttpOnly con SameSite=Lax. El despliegue en Render sigue pendiente. Ninguna credencial de Neon se incorpora al frontend.

La raíz fija Vite 8.3.3 para `@angular/build` mediante un `override`: Angular CLI 22.2.3 incluye Vite 8.3.0, afectado por avisos de seguridad corregidos en ese parche. Revisar este override cuando Angular actualice su dependencia de Vite. Referencia: [aviso GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm).

El build de producción genera los archivos estáticos en `frontend/dist/biblioteca/browser/`. Express sirve esa carpeta y resuelve la navegación SPA después de las rutas de API. Las rutas `/api` desconocidas conservan su respuesta de API y no reciben `index.html`.

`/catalogo` es público y consulta `GET /api/books`, con estados de carga, vacío, error y reintento. La raíz redirige al catálogo hasta integrar la landing de SCRUM-6.

`AuthService` comparte la sesión en memoria y la restaura al cargar. Registro y login aceptan el mismo DTO antes de cerrar el diálogo o navegar; no guardan tokens en almacenamiento web ni necesitan otro GET para confirmar el éxito. Un bloqueo compartido serializa ambas escrituras y evita revalidaciones por foco durante ellas. Las respuestas de restauraciones anteriores se descartan mediante una generación de autenticación. Las próximas pantallas pueden usar `ensureAuthenticated()`: si devuelve `false`, no ejecutan su acción y esperan otro clic después del login. El diálogo de PrimeNG conserva la página, permite Escape y gestiona el foco.

Ambos formularios usan `auth.validation.ts` con `validator`, la misma regla de correo del backend. El correo se recorta y convierte a minúsculas; la contraseña se envía exactamente como se escribió. Los campos usan `type="text" inputmode="email"` para conservar dominios internacionales sin que el navegador los convierta silenciosamente a punycode.

La comprobación de sesión se repite al recuperar foco cuando hay una sesión autenticada y el diálogo está cerrado. Se hace en segundo plano, conserva la cuenta visible y agrupa eventos de foco mientras haya una consulta en curso. No hay polling. Un 401 o el vencimiento retiran la sesión; un fallo temporal durante la revalidación conserva su fecha de vencimiento original.

## Integración con SCRUM-6

La raíz contiene una navegación mínima entre catálogo y registro, la identidad o acceso al login, un reintento de sesión ante fallos, `<router-outlet />` y un único `<app-login-dialog />`. `App` restaura la sesión una vez al arrancar. SCRUM-6 puede implementar la landing como una pantalla registrada en `app.routes.ts` y adaptar esta navegación.

Para conectar el acceso de inicio de sesión, importar `AuthService`, inyectarlo en la pantalla o el encabezado e importar `ButtonModule` de PrimeNG:

```ts
protected readonly auth = inject(AuthService);
```

```html
<p-button label="Iniciar sesión" (onClick)="auth.openLogin()"
  [disabled]="auth.status() === 'loading' || auth.authenticating()"
  [pt]="{ root: { 'aria-controls': 'login-dialog', 'aria-expanded': auth.loginRequested() } }" />
```

El nombre del usuario está disponible en `auth.session()?.user.firstName`. El botón no navega a otra ruta; el modal compartido conserva la pantalla abierta. No montar otro modal ni volver a restaurar la sesión desde el encabezado.

El modal conserva sus dimensiones y los ajustes de PrimeNG dentro de `auth/`, sin selectores de la landing. Al cerrar, devuelve el foco al elemento que lo abrió; si ese elemento desapareció, enfoca su propio host.

Las pruebas de `AuthService` verifican revalidación, vencimiento, respuestas fuera de orden, registro y escrituras concurrentes; las del catálogo verifican su lectura pública y sus estados. Las pruebas de composición comprueban registro autenticado y login sin perder la vista del catálogo.

`auth/login-dialog.spec.ts` prueba el diálogo real de PrimeNG y `AuthService` con HTTP simulado: errores 401 y 503, reintento, devolución de foco, limpieza del formulario y cierre con Cancelar, cruz o Escape, también con una petición pendiente. Estas pruebas no acceden a Neon.

`npm run test:e2e --workspace frontend` ejecuta Playwright en escritorio, tablet y móvil usando Chrome instalado. Comprueba formularios, navegación, cookie HttpOnly, recarga, login, catálogo y desbordamiento horizontal. Sus respuestas HTTP están simuladas: no ejecuta el backend ni escribe en Neon. Las pruebas SQL/HTTP del backend verifican por separado el comportamiento de persistencia. Ver [la integración de registro y login](../docs/integracion-hu02-hu03.md).

Administrar nuevas dependencias desde la raíz siguiendo el [README del repositorio](../README.md).
