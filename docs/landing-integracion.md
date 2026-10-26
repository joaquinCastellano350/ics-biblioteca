# Integración de landing, registro e inicio de sesión

La integración parte de `develop` con las tres historias incorporadas.
Mantiene el diseño de SCRUM-6 y conecta sus accesos
con el servicio de autenticación compartido de registro y login.

## Recorridos

- La raíz `/` muestra la landing. El catálogo `/catalogo` sigue siendo público.
- «Crear cuenta» en la cabecera y «Crear mi cuenta» en el hero abren `/registro`.
  «Volver al inicio» regresa a la landing.
- El registro exitoso establece la sesión mediante `AuthService` y vuelve a la
  landing, que muestra «Hola, nombre». Los accesos de ingreso y registro se
  retiran mientras hay una sesión autenticada, incluido el del hero.
- «Ingresar» abre el único diálogo compartido desde landing, catálogo o registro.
  El login conserva la URL y el contenido de la página; cancelar devuelve el foco
  al botón que lo abrió. El acceso se deshabilita durante la comprobación inicial
  de sesión y mientras hay una autenticación en curso.
- Al recargar se consulta la sesión existente. Un 401 o su vencimiento devuelve
  los accesos de cuenta; un fallo de comprobación ofrece «Reintentar sesión».
- «Saltar al contenido» enfoca el contenido de la ruta actual sin navegar a `/`.
- «Mis préstamos» abre `/prestamos` desde la navegación y marca el acceso activo.
  La pantalla espera a comprobar la sesión y ofrece el diálogo compartido al
  visitante, con acceso al registro. Al cancelar conserva la URL y devuelve el
  foco al botón. Tras autenticar o restaurar sesión muestra la sección en
  preparación; un 401 o el vencimiento vuelve a retirar esa sección.
  Un fallo de comprobación mantiene la pantalla bloqueada y permite reintentar
  desde el aviso compartido de sesión.

No se cambia la lógica de cuentas del backend ni se duplica el estado de sesión.
Se mantienen el DTO compartido, la cookie HttpOnly y el bloqueo de autenticación
concurrente de `AuthService`.

## Pendientes

El listado y las operaciones de préstamos pertenecen a su propia historia.
La sección autenticada informa que está en preparación; no muestra una lista
vacía ni un contador simulados. No se añaden API, tablas ni migraciones de
préstamos. La autorización de los futuros datos deberá aplicarse también en la
API; esta entrega incorpora únicamente el acceso y la presentación condicionada
a la sesión. El cierre de sesión y el vencimiento ya están integrados en `develop`.

## Verificación

Desde la raíz:

```sh
npm test --workspace frontend
npm run build --workspace frontend
npm run test:e2e --workspace frontend
```

Las pruebas de composición verifican los accesos, registro con sesión iniciada,
restauración y pérdida de sesión y login desde la cabecera conservando el
catálogo. Las pruebas de navegador cubren registro desde la landing, login con
error y reintento, identidad, recarga, cookie HttpOnly, navegación por teclado y
ausencia de desbordamiento en escritorio, tablet y celular. El escenario de
login vuelve a ejecutarse en los tres tamaños. Para préstamos se comprueban
acceso directo y desde la navegación, carga de sesión, 503 y reintento, login,
cancelación con Escape, devolución del foco, recarga y salto al contenido.

Las pruebas de navegador interceptan la API; no escriben en Neon. Las pruebas
SQL/HTTP existentes del backend verifican por separado la persistencia de cuentas.

Resultado histórico de esta integración: 100 pruebas de Angular y 21 de navegador aprobadas, sin omisiones.
La compilación termina correctamente con el aviso de tamaño inicial existente
(735,43 kB frente al objetivo de 500 kB). Para esta ejecución se usó temporalmente
el puerto 4208, con un servidor exclusivo de pruebas.

Consultar [los controles de la primera release](release-sprint-1.md) para la verificación actual.
