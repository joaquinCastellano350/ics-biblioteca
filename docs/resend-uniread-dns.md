# DNS de Resend para UniRead

Estado al 31/10/2026: dominio verificado por Resend. DKIM, MX y TXT de SPF y
CNAME figuran como `verified`. Dominio registrado por el titular: `uniread.tech`. Subdominio de envío:
`mail.uniread.tech`, región `sa-east-1` (São Paulo). Solo envío habilitado;
seguimiento de aperturas y clics desactivado.

Resend devolvió estos cuatro registros. Los nombres de la tabla son relativos
a la zona `uniread.tech`; si el panel exige el nombre completo, agregar
`.uniread.tech` al final de cada nombre. No duplicar ese sufijo si el panel
ya lo agrega. Usar TTL automático o 3600 segundos.

| Tipo | Nombre / Host | Valor | Prioridad |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.mail` | Copiar la clave DKIM de abajo | — |
| MX | `send.mail` | `feedback-smtp.sa-east-1.amazonses.com` | 10 |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.mail` | `send.forge.rmta.net` | — |

Valor completo del TXT de DKIM, en una sola línea, sin agregar comillas:

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDWAAV2LwLkZ2bi05q9lVP2EZnFbsAUQ53FpilOwfDpuxDdRxHtxUfANWpEzYJjbnpLBnSgiZsveFqCY3AY4LtSMaz8qVz2MgJMUfue5A73j5CS7riKV1W1RX+8v5TlYWdP8/q1tzlTOEBRPOBZwbhwq0FUY35KfIIrTb2Vu5d8uQIDAQAB
```

Además, se recomienda este registro DMARC inicial, si no existe otro para ese
subdominio. No es uno de los cuatro registros generados por Resend:

| Tipo | Nombre / Host | Valor |
| --- | --- | --- |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none;` |

El titular confirmó la carga de todos los registros el 31/10/2026. Se consultaron
los cuatro registros generados por Resend y se inició la verificación mediante
su complemento. Los nameservers son `ns1.dns.host` a `ns4.dns.host`.
DMARC responde `v=DMARC1; p=none;` en el servidor autoritativo y en los resolutores
públicos 1.1.1.1 y 8.8.8.8. La primera consulta recursiva conservaba una respuesta
negativa anterior; la comprobación autoritativa confirmó el registro publicado.

Resend confirmó el dominio y se configuró este remitente en `.env.local`:

```dotenv
MAIL_FROM="Biblioteca Digital Universitaria <avisos@mail.uniread.tech>"
```

La dirección de la web se configura por separado mediante `PUBLIC_WEB_ORIGIN`;
en el entorno local sigue siendo `http://localhost:4200`. La verificación del
dominio no publica la aplicación web ni activa el workflow.

La prueba del 31/10/2026 envió los tres avisos de préstamos desde ese remitente
al buzón de prueba autorizado. Resend confirmó `delivered` para todos. Repetir
el primer aviso con la misma clave devolvió el mismo ID de correo. Se usó una
base aislada en memoria; no se modificó la base compartida.

Fuentes: registros devueltos por el complemento de Resend y
[guía oficial para agregar y verificar un dominio](https://resend.com/docs/add-a-domain),
[DMARC](https://resend.com/docs/dashboard/domains/dmarc).
