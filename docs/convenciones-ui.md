# Convenciones de UI

Acuerdo del 22 de octubre de 2026. Estas dos convenciones se mantienen para todas las pantallas de la Biblioteca Digital Universitaria:

1. Mantener una apariencia similar al [HTML de referencia compartido](referencias/biblioteca-digital-universitaria.html), conservado sin modificaciones.
2. Usar **PrimeNG** como biblioteca de componentes Angular. Personalizar sus componentes mediante un tema compartido antes de implementar controles equivalentes desde cero.

Los cambios que alteren la línea visual acordada o sustituyan la biblioteca deben consultarse antes de implementarlos. Los ajustes dentro de estas convenciones pueden seguir el desarrollo habitual.

## Referencia visual

La referencia define colores, tipografías, composición, espaciado y apariencia de los controles. Sus scripts, credenciales de demostración, navegación y datos simulados no forman parte de la aplicación ni modifican el PRD, el modelo de Confluence o el contrato de autenticación. El archivo se conserva en documentación y no se sirve con el frontend.

| Elemento | Convención |
| --- | --- |
| Fondo | Crema `#f8f7f2` |
| Color principal | Verde petróleo `#193e46`; hover `#123038` |
| Texto y texto secundario | `#243c42` y `#4d615c` |
| Bordes | `#dfe4dc`, finos y discretos |
| Superficies y acentos | Blanco, salvia `#e9eee5`, lima `#d8ed99` |
| Tipografía de texto | DM Sans |
| Títulos y marca | Manrope; acentos editoriales en Georgia cursiva |
| Controles | Esquinas de 8 px, foco visible verde, etiquetas explícitas |
| Modal | Fondo crema, radio de 16 px, ancho máximo de 470 px y desplazamiento vertical cuando haga falta |
| Composición | Espacio generoso, ilustración de libros, bordes suaves; adaptación a móvil |

Las fuentes se distribuyen con la aplicación mediante Fontsource, sin depender de una solicitud a Google Fonts. Los colores de componentes se centralizan en `frontend/src/app/theme.ts`; los estilos globales y las variables del sitio, en `frontend/src/styles.css`.

## Aplicación en SCRUM-8

El inicio de sesión usa Dialog, Button, InputText, InputPassword y Message de PrimeNG, con el aspecto de la referencia. Mantiene la página actual, los errores de credenciales, el cierre con Escape, la limpieza de contraseña y la devolución del foco. SCRUM-8 entrega el módulo de autenticación y el modal; SCRUM-6 define la landing, el encabezado, la navegación, el footer y la ubicación del acceso de inicio de sesión. El HTML compartido no incorpora por sí mismo pantallas ni datos simulados al alcance de SCRUM-8.

La versión acordada es **Angular 22 + PrimeNG 22 con licencia Community**. La clave proporcionada por Joaquín está configurada en el campo `license` de `frontend/src/app/app.config.ts`; se comprobó en navegador que desaparece el aviso de licencia, tanto en escritorio como en móvil. Su vencimiento es el 22 de octubre de 2027 a las 17:25:52 UTC. No se ha publicado.

La clave se obtiene desde el sitio de [PrimeUI](https://primeui.dev/licenses/community); el titular debe confirmar su elegibilidad y aceptar los términos. Una vez emitida, se incorpora a `providePrimeNG({ license: '…' })`, según la [configuración oficial](https://primeng.dev/configuration). La clave es visible en el bundle del navegador y no es una credencial del backend. No debe publicarse por separado para que terceros eludan obtener su propia licencia.
