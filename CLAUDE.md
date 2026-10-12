# FinTrack — instrucciones para Claude

App de finanzas personales de Rodrigo. Es solo para él, no es un producto. PWA instalada en el iPhone ("Agregar a pantalla de inicio"). El objetivo es que los movimientos entren solos (Mercado Pago) y que usarla se sienta como GymBrain: premium, oscura y gamificada.

## Cómo está armada
- El frontend vive en `index.html`: HTML, CSS y JS vanilla, sin framework ni build. Chart.js por CDN (cdnjs, versión fija).
- `sw.js` es el service worker. **Cada vez que cambies `index.html` (o cualquier archivo cacheado), subí la versión de `CACHE` en `sw.js`.** Si no, el iPhone sigue mostrando la versión vieja.
- `manifest.json` **no lleva `start_url`**: con ella iOS puede dar 404 al abrir desde la pantalla de inicio (mismo problema que en GymBrain).
- Actualizá `APP_VERSION` cuando haya un cambio visible.
- Backend en Cloudflare (ver "Infra"). El frontend nunca habla directo con Mercado Pago.

## Datos (lo más delicado)
- Todo lo del usuario está en `localStorage`. Formato viejo: claves `ft_*` (`ft_transactions`, `ft_savings`, `ft_goals`, `ft_budgets`, `ft_recurring`, `ft_recurring_log`, `ft_rules`, `ft_income_yields`, `ft_yield_last_run`, `ft_quick_add`, `ft_daily_limit`, `ft_crypto_watchlist`, `ft_stocks_watchlist`, `ft_quotes_cache`, `ft_splash_seen`).
- **Nunca borres ni pises las claves `ft_*`.** La migración lee de ahí y escribe en el formato nuevo; las viejas quedan como respaldo.
- **No cambies claves ni formatos sin una migración versionada** (`schemaVersion`) que corra una sola vez, sea idempotente y deje un backup antes de tocar nada.
- Export/import en JSON con validación: nada se importa sin pasar el validador, y siempre se muestra una vista previa (cuántos movimientos, rango de fechas) antes de reemplazar.
- Los movimientos que vienen de Mercado Pago se deduplican por su ID de MP. Una corrección manual del usuario (categoría, nota) nunca se pisa en una sincronización.
- Fechas: usá la fecha **local** de Argentina (`America/Argentina/Buenos_Aires`), nunca `toISOString().split('T')[0]` (da el día siguiente después de las 21 h).
- Montos: guardá el monto original en su moneda; las conversiones a USD se calculan al mostrar y guardan qué cotización se usó.

## Seguridad
- **El access token de Mercado Pago nunca va al frontend, al repo ni a un log.** Vive solo como secret de Cloudflare (`wrangler secret put MP_ACCESS_TOKEN`).
- El backend expone solo endpoints de lectura de MP. Nada que cree pagos, reembolsos ni transferencias.
- La API nunca atiende sin protección (falla cerrado). Hoy: contraseña propia por Basic Auth (secret `FINTRACK_PASSWORD`). Cuando la app se mude a Cloudflare: todo detrás de Cloudflare Access (solo el email de Rodrigo) y la API valida el JWT (`Cf-Access-Jwt-Assertion`); `worker/src/auth.js` ya soporta los dos modos.
- No subas al repo `.dev.vars`, backups JSON ni CSV de movimientos reales (están en `.gitignore`).

## Estética
- Base: el diseño de las 10 pantallas que hizo Design (FinTrack · App). Oscura, editorial y precisa: nunca fondo blanco ni diseño plano o genérico.
- Tokens: `--bg #0B0C0F`, líneas `#23252D` / `#2E313A`, texto `#EEEAE2`, texto 2 `#C9C5BD`, apagado `#85868E` / `#6C6D75`, acento cobalto `#4157FF`, verde `#8FC79A`, rojo `#E07A86`.
- Tipografías: Newsreader (cifras grandes), Geist (texto), Geist Mono (etiquetas en mayúsculas con tracking). Bordes rectos (radio 3 px).
- Íconos y logo: SVG propios (trazo 1.5, `stroke-linecap: square`), en un objeto central. Nada de emojis como íconos.
- Lo que tiene "alma" (cinemáticas de nivel y meta cumplida, XP flotante, confeti, gráficos animados) no se borra ni se simplifica.
- Textos en español rioplatense con voseo ("gastaste", "dale", "vas bárbaro"), con onda y sin frases de app genérica.

## Producto
- La gamificación es central: XP, niveles, rachas (días sin gastos hormiga, meses cumpliendo presupuesto), misiones semanales de ahorro, logros y cinemáticas. No la recortes.
- Mobile-first en iPhone: respetá las safe areas (la isla no tapa headers), botones de al menos 44 px, navegación atrás con stacks + `popstate` que funcione con el gesto de iOS.

## Infra
- La API vive en `worker/` (Cloudflare Worker `fintrack-api`, config en `worker/wrangler.jsonc`). Se despliega solo con Workers Builds en cada push a `main` (raíz `worker`, comando `npx wrangler deploy`). Rodrigo no instala nada en su compu.
- `worker/src/mp.js` es el cliente de Mercado Pago: solo GET y normalización a movimientos (`fecha, monto, moneda, sentido, tipo, descripcion, contraparte`). Montos negativos = sale plata.
- Endpoints `/v1/payments/search` (marcado legacy, sin fecha de baja), `/mercadopago_account/*` (no documentados) y `/v1/orders` (solo cobros de la integración): cualquiera puede dejar de andar; el código tiene que tolerar que una fuente falle sin romper las demás.
- Probado con la cuenta real (12/10/2026):
  - `payments/search?payer.id=<yo>` **sí** trae los pagos que hace Rodrigo (QR, Uber, transferencias a otros usuarios de MP, compras con tarjeta). En esos MP manda `payer_id` en el primer nivel y el destinatario en `collector` (nombre, email).
  - `payments/search?collector.id=<yo>` trae lo que cobra (transferencias recibidas, etc.), con el objeto `payer`.
  - `/mercadopago_account/movements/search` y `/users/{id}/mercadopago_account/balance` dan 403: **no hay saldo ni rendimientos por API**.
  - `/v1/orders` responde pero vacío (solo ve cobros hechos con la integración).
  - Las fechas vienen en `-04:00`: convertir siempre al día de Argentina.
- Más adelante: frontend en Cloudflare (Pages o el mismo Worker con static assets), D1 para movimientos y cron diario.
- Secrets y bindings se configuran en el panel de Cloudflare, nunca en el código.
- Pruebas del Worker (con Mercado Pago simulado): `node --test worker/test/worker.test.mjs worker/test/report.test.mjs`.

## Cómo trabajar
1. Antes de commitear, probá con Playwright en viewport de iPhone 13 (390×844). Sacá screenshots de las pantallas que tocaste y fijate que no haya errores en la consola. Probá también la navegación atrás.
2. Si tocaste datos: probá la migración con un `localStorage` armado con datos viejos (incluidos los casos raros: reglas con categoría numérica, ahorros con `platform`, categorías `comida`/`entretenimiento`).
3. Cambios chicos y commits claros, en español.
4. Si un cambio puede romper datos guardados, avisá antes de hacerlo.
5. Al terminar, resumí en 2-3 líneas qué cambió y qué tiene que mirar Rodrigo en el celu.
