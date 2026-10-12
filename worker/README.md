# FinTrack API (Cloudflare Worker)

Worker que guarda el token de Mercado Pago como secret, habla con MP y le devuelve los datos a la app. Etapa 0: `/test`, `/reporte` y `/detalle`.

Dirección: <https://fintrack-api.rodricingolani1.workers.dev> · se redespliega solo con cada push a `main` que toque `worker/`.

## Endpoints

- `GET /test` → últimos 20 movimientos normalizados, saldo (si MP lo da) y un diagnóstico de cada fuente (`fuentes`: qué respondió, con qué código y qué campos trae).
- `GET /detalle?id=` → qué sabe Mercado Pago de una operación puntual (diagnóstico).
- `GET /reporte` → reporte de dinero en cuenta de los últimos 30 días (incluye transferencias a CBU/CVU de otros bancos). La primera vez lo pide y crea la configuración de reportes en tu cuenta de MP (sin programación automática); a los 2-3 minutos, volvé a abrirlo y lo descarga y resume.

Todo pide contraseña (Basic Auth con el secret `FINTRACK_PASSWORD`). Sin contraseña configurada, el Worker no atiende nada.

## Secrets (se cargan en el panel, nunca en el repo)

| Nombre | Qué es |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de producción de Mercado Pago (`APP_USR-…`) |
| `FINTRACK_PASSWORD` | Tu contraseña para abrir el Worker |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAIL` | Opcionales, para cuando pasemos a Cloudflare Access |

## Puesta en marcha, paso a paso (sin instalar nada)

### 1. Crear la cuenta de Cloudflare
1. Entrá a <https://dash.cloudflare.com/sign-up>, poné tu email y una contraseña.
2. Confirmá el email con el link que te llega.
3. Si te pregunta qué querés hacer o te ofrece agregar un dominio, salteá. El plan Workers Free no pide tarjeta.

### 2. Conectar el repo y desplegar
1. En el menú de la izquierda: **Compute (Workers)** → **Workers & Pages** → **Create**.
2. En la pestaña **Workers**, elegí **Import a repository** → **Connect GitHub**.
3. GitHub te pide autorizar la app de Cloudflare: elegí **Only select repositories** → `Fintrack` → **Install & Authorize**.
4. De vuelta en Cloudflare, elegí el repo `Fintrack` y completá:
   - **Project name**: `fintrack-api` (tiene que ser exactamente este, es el de `wrangler.jsonc`).
   - **Build command**: vacío.
   - **Deploy command**: `npx wrangler deploy`.
   - Abrí **Advanced settings** → **Path** (root directory): `worker`.
5. **Create and deploy**. Tarda alrededor de un minuto. Si te pide elegir un subdominio `workers.dev`, poné algo corto (por ejemplo, tu nombre).
6. Al terminar vas a ver la dirección del Worker: `https://fintrack-api.<tu-subdominio>.workers.dev`. Guardala.

Desde ahora, cada vez que se suba un cambio a `main` en GitHub, Cloudflare redespliega solo. Sigue andando cuando pases el repo a privado.

### 3. Cargar los secrets
1. Abrí el Worker `fintrack-api` → **Settings** → **Variables and Secrets** → **Add**.
2. **Type: Secret**, **Variable name**: `MP_ACCESS_TOKEN`, **Value**: tu Access Token de producción → **Deploy**.
3. Repetí con `FINTRACK_PASSWORD`. Usá una contraseña larga y nueva (por ejemplo, que la invente el llavero del iPhone) y guardala en Contraseñas.

Los secrets no se pueden volver a leer desde el panel; si te equivocás, cargalo de nuevo con el mismo nombre.

### 4. Probar desde el celu
1. Abrí `https://fintrack-api.<tu-subdominio>.workers.dev/test` en Safari.
2. Te pide usuario y contraseña: el usuario da igual (poné `rodrigo`), la contraseña es `FINTRACK_PASSWORD`.
3. Vas a ver un JSON con `movimientos`, `saldo` y `fuentes`.

| Si ves | Qué pasa |
|---|---|
| `El Worker no tiene protección configurada` | Falta `FINTRACK_PASSWORD` |
| `Falta el secret MP_ACCESS_TOKEN` | Falta el token |
| `El token no anda` | El token está mal copiado o es el de prueba |
| `fuentes.*.ok: false` | Esa fuente no está disponible para tu cuenta (es parte de lo que queremos averiguar) |

## Desarrollo

Pruebas con Mercado Pago simulado (desde la raíz del repo): `node --test worker/test/*.mjs`.
