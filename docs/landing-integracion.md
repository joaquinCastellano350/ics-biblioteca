# Landing y navegación — SCRUM-6

La ruta / muestra la landing de la PR #6 y permite explorar el catálogo público.
La cabecera, navegación y pie mantienen el diseño y los controles de esa PR.

## Resolución de conflictos con develop

Se combinan la landing en /, el catálogo en /catalogo y la ruta /registro de
develop. Se conservan los módulos, la restauración de sesión, el diálogo único y
el reintento de sesión existentes, sin conectar nuevas acciones en la cabecera.
La lógica del backend y los servicios de cuentas no cambian respecto de develop.

Ingresar, Crear cuenta, Crear mi cuenta y Mis préstamos permanecen deshabilitados.
La cabecera no muestra la identidad. El formulario de registro sigue disponible
por su URL directa; su éxito y Volver al inicio llegan a la landing.

## Seguimiento

Otra PR habilitará los accesos de cuenta y completará la presentación de sesión
en la nueva cabecera. El acceso protegido a préstamos sigue pendiente. También
queda fuera de esta resolución el ajuste del salto por teclado en rutas distintas
del inicio que se detectó durante las pruebas de integración.

## Verificación

Las pruebas de navegación conservan las expectativas de controles deshabilitados
de la PR #6. La prueba de registro usa la URL directa y verifica formulario,
cookie y consulta de sesión al recargar. El escenario de navegador que abre el
login desde la cabecera se omite explícitamente hasta la PR de seguimiento
(una ejecución por cada tamaño). Las pruebas unitarias del servicio, diálogo y
login invocado desde AuthService siguen activas. Se usan respuestas HTTP simuladas,
sin escrituras en Neon.

Resultado: 95 pruebas unitarias aprobadas; 12 pruebas de navegador aprobadas y
3 omitidas por el acceso de login pendiente; compilación correcta, con el aviso
de bundle inicial de 732,20 kB frente al objetivo de 500 kB.
