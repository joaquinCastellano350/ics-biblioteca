# Landing y navegación — SCRUM-6

La ruta `/` presenta la biblioteca y conduce al catálogo público mediante sus
dos llamadas a la acción. La cabecera y el pie se comparten con `/catalogo`.
La navegación se adapta a computadora, tablet y celular sin menú oculto.
Los botones utilizan PrimeNG y el tema definido por el scaffolding de `main`.

Los accesos a ingreso, registro y préstamos permanecen visibles y deshabilitados
hasta integrar las historias del equipo. No existen pantallas de placeholder,
diálogos de «próximamente», rutas personales simuladas ni datos de sesión falsos.
Al integrar esas historias se sustituye `disabled` por su navegación o acción real;
el ingreso desde catálogo podrá usar el popup contextual de autenticación real.
La landing no implementa autenticación, permisos ni circulación.

Se mantiene el acceso por teclado, el enlace para saltar al contenido y la marca
de la página activa. Playwright verifica ambos destinos públicos y los controles
deshabilitados a 1440, 768 y 320 píxeles. Los datos de catálogo de esas pruebas son
fixtures del navegador; no se incorporan al producto ni se cargan en Neon.

La integración de cuentas y préstamos sigue pendiente; su acceso funcional no
puede darse por validado hasta que existan las funcionalidades del equipo.
