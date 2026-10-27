# ADR-0002 — Un único origen web para Angular y la API

Estado: aceptado por el usuario el 22 de octubre de 2026. Sustituye únicamente la distribución del frontend y la API del ADR-001. La integración de archivos estáticos y fallback SPA está implementada en Express; el despliegue en Render sigue pendiente.

El [ADR-001](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/5177345) definía Angular en Render Static Site y Express en Render Web Service. Para evitar depender de cookies entre sitios, serviremos el build estático de Angular desde Express en un único Render Web Service, compartiendo un origen HTTPS con `/api`.

Se mantienen los mismos proveedores: Render para la web/API y Neon para PostgreSQL y Object Storage. Angular continúa siendo una SPA compilada como archivos estáticos; Express la servirá junto con la API. El entorno local conserva `ng serve` y su proxy. La elección de token opaco o JWT es independiente del lugar donde se aloja el frontend. El [contrato de autenticación](../contrato-autenticacion.md) define la sesión opaca prevista en el modelo de datos.

Angular usará rutas relativas `/api/...`. La cookie `biblioteca_session` tendrá `HttpOnly; Secure; SameSite=Lax` en producción. Las llamadas de la SPA a la API no necesitan CORS ni configuración de credenciales para otro origen. Se mantiene el encabezado de protección de escrituras definido en el contrato.

La implementación deberá compilar ambos workspaces y servir `frontend/dist/biblioteca/browser/`, con fallback de navegación SPA después de las rutas de API; `/api` no debe responder con `index.html`. Se acoplan las publicaciones del frontend y backend y, si el servicio web se suspende, también la primera carga de la SPA puede demorarse. Las credenciales y PDFs privados quedan fuera del directorio público. Antes de publicar se verificará login, recarga de rutas, logout y acceso desde el correo en el origen HTTPS elegido.

Referencias: [MDN: cookies de terceros en solicitudes CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#third-party_cookies) y [Express: servir archivos estáticos](https://expressjs.com/en/starter/static-files/).
