# FinTrack — instrucciones para Claude

App de finanzas personales de Rodrigo. Es solo para él, no es un producto. PWA instalada en el iPhone ("Agregar a pantalla de inicio"). El objetivo es que los movimientos entren solos (Mercado Pago) y que usarla se sienta como GymBrain: premium, oscura y gamificada.

Rodrigo no usaba la app vieja: **no hay datos guardados que migrar**. Se arranca de cero con los datos que entran solos.

## Cómo está armada
- El frontend vive en `index.html`: HTML, CSS y JS vanilla, sin framework ni build. Chart.js por CDN (cdnjs, versión fija).
- `sw.js` es el service worker. **Cada vez que cambies `index.html` (o cualquier archivo cacheado), subí la versión de `CACHE` en `sw.js`.** Si no, el iPhone sigue mostrando la versión vieja.
- `manifest.json` **no lleva `start_url`**: con ella iOS puede dar 404 al abrir desde la pantalla de inicio (mismo problema que en GymBrain).
- Actualizá `APP_VERSION` cuando haya un cambio visible.
- Backend en Cloudflare (ver "Infra"). El frontend nunca habla directo con Mercado Pago.

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
- Más adelante: frontend en Cloudflare (Pages o el mismo Worker con static assets), D1 para movimientos y cron diario.
- Secrets y bindings se configuran en el panel de Cloudflare, nunca en el código.
- Pruebas del Worker (con Mercado Pago simulado): `node --test worker/test/*.mjs`.

## Cómo trabajar
1. Antes de commitear, probá con Playwright en viewport de iPhone 13 (390×844). Sacá screenshots de las pantallas que tocaste y fijate que no haya errores en la consola. Probá también la navegación atrás.
2. Si tocaste el Worker: corré las pruebas y, después del deploy, verificá contra los datos reales de Rodrigo.
3. Cambios chicos y commits claros, en español.
4. Si un cambio puede romper datos guardados, avisá antes de hacerlo.
5. Al terminar, resumí en 2-3 líneas qué cambió y qué tiene que mirar Rodrigo en el celu.
