# FinTrack — instrucciones para Claude

App de finanzas personales de Rodrigo. Es solo para él, no es un producto. PWA instalada en el iPhone ("Agregar a pantalla de inicio"). El objetivo es que los movimientos entren solos (Mercado Pago) y que usarla se sienta como GymBrain: premium, oscura y gamificada.

Rodrigo no usaba la app vieja: **no hay datos guardados que migrar**. Se arranca de cero con los datos que entran solos.

## Cómo está armada
- Todo vive en `worker/`: un solo Cloudflare Worker (`fintrack-api`) que sirve la app (`worker/public/`), la API (`/api/*`) y sincroniza con Mercado Pago por cron. Dirección: https://fintrack-api.rodricingolani1.workers.dev
- Frontend: `worker/public/index.html` (HTML + CSS con los tokens del diseño) y `worker/public/app.js` (JS vanilla, sin framework ni build). Gráficos en SVG propio, animados.
- `worker/public/sw.js` es el service worker. **Cada vez que cambies un archivo de `public/`, subí la versión de `CACHE` en `sw.js`.** Si no, el iPhone sigue mostrando la versión vieja.
- El manifest **no lleva `start_url`**: con ella iOS puede dar 404 al abrir desde la pantalla de inicio (mismo problema que en GymBrain).
- Actualizá `APP_VERSION` cuando haya un cambio visible.
- El frontend nunca habla directo con Mercado Pago. Sí puede llamar a DolarApi (público).

## Datos (lo más delicado)
- La fuente de verdad va a ser el backend (D1), alimentado por las sincronizaciones. El frontend guarda una copia para andar offline.
- **No cambies formatos guardados sin una migración versionada** (`schemaVersion`) que corra una sola vez y sea idempotente. Desde que haya datos reales, nada se pierde.
- Export/import en JSON con validación: nada se importa sin pasar el validador, y siempre se muestra una vista previa (cuántos movimientos, rango de fechas) antes de reemplazar.
- Cada movimiento se deduplica por el ID de su fuente (`pay_<id MP>`). Una corrección manual (categoría, nota, gasto compartido) nunca se pisa en una sincronización.
- Fechas: usá la fecha **local** de Argentina (`America/Argentina/Buenos_Aires`), nunca `toISOString().split('T')[0]` (da el día siguiente después de las 21 h).
- Montos: guardá el monto original en su moneda (ARS, USD, USDC); las conversiones se calculan al mostrar y guardan qué cotización se usó.

## Cómo se mueve la plata de Rodrigo (reglas de clasificación)
- **Sueldo**: entra a ICBC el **segundo día hábil del mes** (ICBC no tiene API: ingreso fijo mensual, el monto lo carga él). Después pasa una parte a Mercado Pago por **DEBIN** en los primeros días del mes: eso es **movimiento interno**, no ingreso.
- **Bolsillos**: MP disponible (saldo anclado una vez + movimientos del reporte), reserva "Emergencias" (rinde 19%), inversiones de MP (renta fija y variable, valor manual), dólares de MP (manual, no salen por API), Cocos (manual), ICBC (manual), Binance (manual: casi todo en USDC, es donde tiene más plata; los ingresos extra entran ahí semanalmente y él los carga a mano).
- **Solo Mercado Pago es automático.** Binance, Cocos e ICBC no se integran (decisión de Rodrigo): la carga manual tiene que ser rapidísima.
- **Rendimientos de MP**: vienen en el reporte como dos filas `SETTLEMENT` positivas por madrugada, sin medio de pago, sin persona y sin referencia: una es del disponible y otra de la reserva (se distinguen por cuál se acerca a saldo × tasa diaria de cada bolsillo). La de la reserva no suma al disponible.
- **Gasto compartido**: ej. paga la tarjeta de su mamá (−$1.930.000) y el hermano le pasa su parte (+$1.190.000) el día antes: el gasto real es la diferencia y lo del hermano no es ingreso. Lo mismo con amigos que le transfieren su parte.
- **Pasamanos**: entra y sale el mismo monto el mismo día (ej. $595.000): preguntar si se ignora.

## Seguridad
- **El token de Mercado Pago (`MP_ACCESS_TOKEN`) nunca va al frontend, al repo ni a un log.** Vive solo como secret de Cloudflare.
- Solo lectura: nada que cree pagos, reembolsos ni transferencias. La única escritura permitida es pedir reportes de MP.
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
- `worker/src/mp.js` es el cliente de Mercado Pago y normaliza a movimientos (`fecha, dia, monto, moneda, sentido, tipo, descripcion, contraparte`). Montos negativos = sale plata. `worker/src/report.js` pide y lee el reporte de dinero en cuenta.
- Endpoints `/v1/payments/search` (marcado legacy, sin fecha de baja), `/mercadopago_account/*` (no documentados) y `/v1/orders` (solo cobros de la integración): cualquiera puede dejar de andar; el código tiene que tolerar que una fuente falle sin romper las demás.
- Probado con la cuenta real (12/10/2026):
  - `payments/search?payer.id=<yo>` **sí** trae los pagos que hace Rodrigo (QR, Uber, transferencias a otros usuarios de MP, compras con tarjeta). En esos MP manda `payer_id` en el primer nivel y el destinatario en `collector` (nombre, email).
  - `payments/search?collector.id=<yo>` trae lo que cobra (transferencias recibidas, etc.), con el objeto `payer`.
  - `/mercadopago_account/movements/search` y `/users/{id}/mercadopago_account/balance` dan 403: **no hay saldo ni rendimientos por API**.
  - `/v1/orders` responde pero vacío (solo ve cobros hechos con la integración).
  - Las fechas vienen en `-04:00`: convertir siempre al día de Argentina. Usar `date_created` (lo que muestra la app de MP); `date_approved` llega días después en pagos con la prepaga.
  - El **reporte de dinero en cuenta** (`/v1/account/settlement_report`) trae todo lo que mueve el disponible, verificado al centavo contra la app: `SETTLEMENT` (pagos y cobros, mismo ID que payments), `PAYOUTS` (transferencias a CBU/CVU de otros bancos y QR de otras billeteras, **sin destinatario**), `REFUND` y los rendimientos. Llega con 1-3 días de atraso. No incluye la cuenta en dólares.
  - Los `PAYOUTS` y los rendimientos no existen en `/v1/payments/{id}` (404).
- Backend (worker/src): `index.js` (router + cron), `auth.js`, `api.js` (`/api/state`, `/api/sync`, `/api/movements`, `/api/kv/:key`, `/api/rules/:id`, `/api/export`, `/api/import`), `sync.js` (búsqueda de pagos cada 2 h + reporte diario), `report.js`, `classify.js` (categorías, reglas de fábrica y aprendizaje), `db.js` (D1: tablas `movements`, `rules`, `kv`; el esquema se crea solo).
- D1 `fintrack` (id en `wrangler.jsonc`). Cron `17 */2 * * *`. Primera sincronización: 364 días de pagos + reporte de 120 días.
- `kv` guarda: `me`, `sync` (estado), `pockets`, `budgets`, `goals`, `game`, `prefs`.
- Secrets y bindings se configuran en el panel de Cloudflare, nunca en el código.
- Pruebas del Worker (con Mercado Pago simulado): `node --test worker/test/*.mjs`.

## Cómo trabajar
1. Antes de commitear, probá con Playwright en viewport de iPhone 13 (390×844). Sacá screenshots de las pantallas que tocaste y fijate que no haya errores en la consola. Probá también la navegación atrás.
2. Si tocaste el Worker: corré las pruebas y, después del deploy, verificá contra los datos reales de Rodrigo.
3. Cambios chicos y commits claros, en español.
4. Si un cambio puede romper datos guardados, avisá antes de hacerlo.
5. Al terminar, resumí en 2-3 líneas qué cambió y qué tiene que mirar Rodrigo en el celu.

## Estado actual (12/10/2026)
Hecho y desplegado: sincronización con Mercado Pago (cron cada 2 h + reporte diario), D1, clasificación y reglas que aprenden, y la app completa en `public/` con las pantallas del diseño (Inicio, Movimientos, detalle/edición, Cargar, Análisis, Presupuestos, Ahorros y bolsillos, metas, Cotizaciones, Recurrentes, Tu progreso, Reglas, Avisos, Resumen mensual, Ajustes con backup). La app vieja de GitHub Pages se borró.

Cómo está pensada la lógica de la app (`public/app.js`):
- Router con stacks por pestaña (inicio, movs, analisis, ahorros) + `popstate`. "Cargar" se abre desde el botón central. La animación de entrada es solo al cambiar de pantalla.
- Bolsillos en `kv.pockets` con ancla `{amount, ts}`: saldo = ancla + movimientos del bolsillo posteriores. MP disponible y reserva se actualizan solos; el resto es manual (actualizar valor = nueva ancla + snapshot).
- Totales: gastos = `kind gasto` (+ `reintegro` vinculado resta del gasto y su categoría); ingresos = `kind ingreso`; `interno` y `descartado` no cuentan. USD/USDC se pasan a pesos con la cotización elegida (blue por defecto, DolarApi).
- Hormiga: capricho de menos de $10.000 (configurable). XP derivada de los datos; `kv.game` guarda solo lo ya celebrado para disparar cada cinemática una vez. Nivel L requiere 50·L·(L−1) XP.
- Recurrentes: mismo comercio (o mismo monto en transferencias a otros bancos) en 2 de los últimos 3 meses, monto ±20%, día parecido.

Pendiente:
- Cloudflare Access para entrar desde el iPhone con el email (la contraseña Basic Auth funciona pero en la app instalada la pide seguido). `auth.js` ya valida el JWT si se cargan `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD`.

## Probar en la compu
- `worker/.dev.vars` (no se sube) con `FINTRACK_PASSWORD=...` y `DEV_NO_AUTH=1`. **`DEV_NO_AUTH` nunca se carga en el panel de Cloudflare**: saltea la protección.
- Base local con datos inventados: generarlos y cargarlos con `npx wrangler d1 execute fintrack --local --file=<seed.sql>` desde `worker/`.
- Levantar: `npx wrangler dev -c worker/wrangler.jsonc --port 8787 --persist-to worker/.wrangler/state` (también está en `.claude/launch.json`). Probar en viewport 390×844.
