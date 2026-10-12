// Protección del Worker. Dos modos, el primero que esté configurado gana:
//  1. Cloudflare Access: ACCESS_TEAM_DOMAIN + ACCESS_AUD (+ ALLOWED_EMAIL). Se valida el JWT que pone Access.
//  2. Contraseña propia (Basic Auth): FINTRACK_PASSWORD. El navegador del celu la pide solo.
// Si no hay ninguno configurado, no se atiende nada (falla cerrado).

const enc = new TextEncoder();

export async function authorize(request, env) {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return (await checkAccess(request, env)) ? null : deny(403, 'Acceso denegado.');
  }
  if (env.FINTRACK_PASSWORD) {
    return (await checkBasic(request, env.FINTRACK_PASSWORD)) ? null : askPassword();
  }
  return deny(503, 'El Worker no tiene protección configurada (falta FINTRACK_PASSWORD). No atiendo nada hasta que la cargues.');
}

function deny(status, msg) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function askPassword() {
  return new Response('Necesitás la contraseña de FinTrack.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="FinTrack", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ── Basic Auth ────────────────────────────────────────────────
async function checkBasic(request, expected) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const pass = decoded.slice(decoded.indexOf(':') + 1); // el usuario da igual
  return safeEqual(pass, expected);
}

// Comparación en tiempo constante (sobre los hashes, así no importa el largo)
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ── Cloudflare Access (JWT RS256) ─────────────────────────────
let certsCache = { at: 0, keys: [] };

async function accessKeys(team) {
  if (Date.now() - certsCache.at < 3600_000 && certsCache.keys.length) return certsCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) return [];
  certsCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return certsCache.keys;
}

function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}

async function checkAccess(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch {
    return false;
  }
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return false;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD) || payload.exp < now || payload.iss !== `https://${team}`) return false;
  if (env.ALLOWED_EMAIL && String(payload.email || '').toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return false;
  return true;
}
