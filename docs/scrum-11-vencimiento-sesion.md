# SCRUM-11 — Volver a autenticarse al vencer la sesión

## Referencias y alcance

Implementación sobre la base de login, registro y logout de `develop`. Fuentes consultadas el 25 de octubre de 2026:

- [SCRUM-11 / HU-06](https://joaquincastellano350.atlassian.net/browse/SCRUM-11): seis horas absolutas, bloqueo de funciones personales y nuevo clic después de autenticarse desde el catálogo.
- [Modelo de datos de Confluence, v4](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762): `sessions.expires_at = created_at + 6 horas`; autorización con `revoked_at IS NULL` y hora de PostgreSQL estrictamente anterior a `expires_at`.
- [ADR-001, v2](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/5177345): Angular y Express bajo el mismo origen de Render; PostgreSQL y almacenamiento privado en Neon.
- [PRD, v7](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/196609): catálogo público y funciones personales autenticadas.
- [Convenciones de UI](convenciones-ui.md): PrimeNG 22 y apariencia de la referencia HTML compartida. Se reutiliza el diálogo existente y la presentación de Mis préstamos.

No hay nuevas tablas, migraciones, cookies, dependencias ni cambios de hosting. Se conserva el token opaco HttpOnly y el único campo `email` del modelo. PostgreSQL sigue siendo la autoridad; la comprobación del navegador solo controla la presentación.

## Comportamiento

La actividad no renueva la sesión ni reemite su cookie. Al vencer, se retiran la identidad de la cabecera y el estado autenticado de Mis préstamos. No se abre un diálogo espontáneamente ni se navega a otra página.

`AuthService` calcula un plazo con el reloj monotónico del navegador y la diferencia `expiresAt - serverTime`. Descuenta conservadoramente el tiempo de la petición; una revalidación de la misma sesión nunca amplía el plazo anterior. Un cambio de la hora local no concede tiempo adicional. Antes de una acción y al recuperar foco o visibilidad se comprueba el plazo, aunque el callback del temporizador haya quedado suspendido. Si sigue vigente, foco/visibilidad pueden revalidar con la API, agrupando consultas simultáneas. No hay polling.

Una respuesta `401` con `error.code = AUTH_REQUIRED` de una petición protegida retira la sesión y abre el único diálogo. Los datos o errores de solicitudes anteriores a un vencimiento, rechazo de sesión, login, registro o logout se descartan. Los errores de red, `503`, permisos y credenciales no disparan esa reautenticación global.

## Integrar funciones protegidas

### Angular

En el manejador de la acción, envolver la creación de la solicitud en `protectedRequest`. La función se llama solo cuando hay una sesión conocida vigente. Sin sesión termina sin emitir, abre el diálogo y no almacena una continuación. Al completar login la persona vuelve a pulsar el botón. `ensureAuthenticated()` sigue disponible para comprobaciones previas que no envían HTTP.

```ts
solicitar(): void {
  this.auth.protectedRequest(() => this.http.post('/api/ruta-protegida', this.payload, {
    headers: { 'X-Biblioteca-Request': '1' },
  })).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
    next: resultado => this.mostrarResultado(resultado),
    error: () => this.mostrarErrorReintentable(),
  });
}
```

El wrapper no reintenta ni transforma las respuestas de éxito. Los errores distintos de `AUTH_REQUIRED` se entregan al llamador; al descartar una respuesta o pedir autenticación, el observable completa sin emitir. Usar `finalize` para retirar indicadores de carga y no interpretar `complete` como éxito. Una operación que el servidor ya autorizó puede haber ocurrido aunque su respuesta se descarte; cancelar o descartar no hace rollback.

Las vistas personales deben depender de la sesión actual y limpiar su estado al perderla o cambiar de cuenta. No conservar respuestas privadas en una caché compartida entre cuentas. Mis préstamos ya cambia su presentación con el estado compartido; su listado real sigue pendiente.

### Express

`requireSession(accounts)` exportado por `accounts.controller.ts` comprueba la sesión antes de entrar al handler. Consulta la persistencia en cada solicitud, sin caché ni renovación, y deja únicamente `{ userId, sessionId, expiresAt }` en `res.locals.identity`. Las respuestas llevan `Cache-Control: no-store`; sin sesión vigente devuelve `401 AUTH_REQUIRED` mediante `accountErrorHandler`. Una falla de conexión conserva la clasificación `503`.

```ts
router.get('/ruta-personal', requireSession(accounts), async (_req, res) => {
  const resultado = await servicio.consultarPropios(res.locals.identity.userId);
  res.json(resultado);
});
```

Montar estas rutas después de los middlewares HTTP de cuentas y antes del fallback `/api`; conservar la protección de escrituras y el manejador de errores. El middleware valida identidad y vigencia: cada servicio sigue siendo responsable de consultar por ese `userId` y de validar la titularidad del recurso, como exige SCRUM-9. Un identificador del cuerpo, query o URL no sustituye la identidad.

## Validación y dependencias

- `auth.expiry.spec.ts`: actividad, latencia, pestaña suspendida, respuestas viejas, varios `AUTH_REQUIRED`, nuevo clic y errores de infraestructura.
- `reauthentication.spec.ts`: App, catálogo, filtro de autor y diálogo PrimeNG reales, con una acción protegida exclusiva del fixture; conserva URL, instancias del catálogo/filtro y foco, permite cancelar y exige otro clic después de login.
- `session-expiry.test.ts`: solicitudes HTTP directas de lectura y escritura, con reloj controlado del repositorio; prueba antes, exactamente en y después del vencimiento, token ausente/desconocido/revocado, rechazo antes de los handlers y fallo de base.
- `accounts-scenarios.ts`: Prisma y PostgreSQL embebido; las consultas no alteran el vencimiento almacenado, una cookie conservada no autoriza al vencer y un nuevo login crea otras seis horas con otro token.
- `e2e/session-expiry.spec.ts`: reloj acelerado en Chrome; retira la identidad y la sección autenticada, permite cancelar con foco restaurado y volver a ingresar sobre la misma ruta, en escritorio, tablet y móvil.

Comandos desde la raíz:

```sh
npm test
npm run build
npm run test:e2e --workspace frontend -- session-expiry.spec.ts
```

Estas pruebas usan HTTP simulado o PostgreSQL en memoria; no escriben en Neon ni esperan seis horas reales. Los endpoints personales y las acciones reales de préstamo/cola aún no existen en esta base: su conexión con estos puntos compartidos se realiza en SCRUM-9 y las historias de circulación. Los endpoints y el botón de prueba no se publican en la aplicación. La aceptación de reservas desde correo tiene su continuación propia de SCRUM-26 y no usa una repetición automática global.
