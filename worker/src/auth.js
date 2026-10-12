// Protección del Worker. El primer modo configurado gana:
//  1. Cloudflare Access: ACCESS_TEAM_DOMAIN + ACCESS_AUD (+ ALLOWED_EMAIL). Se valida el JWT que pone Access.
//  2. Contraseña propia (FINTRACK_PASSWORD): pantalla de login → cookie de sesión firmada que dura un año
//     (en el iPhone, la app instalada no recuerda Basic Auth). También se acepta Basic Auth, para scripts.
// Si no hay ninguno configurado, no se atiende nada (falla cerrado).
// Públicos (no tienen nada privado): íconos y manifest, porque iOS los pide sin sesión al instalar.

const enc = new TextEncoder();
const COOKIE = 'ft_s';
const SESSION_DAYS = 365;
const PUBLIC = /^\/(icon(-\d+)?\.(png|svg)|manifest\.webmanifest)$/;

export async function authorize(request, env) {
  // Solo para probar en la compu: DEV_NO_AUTH vive en worker/.dev.vars, que wrangler nunca sube.
  // NUNCA cargarla en el panel de Cloudflare.
  if (String(env.DEV_NO_AUTH ?? '').trim() === '1') return null;
  const url = new URL(request.url);
  if (request.method === 'GET' && PUBLIC.test(url.pathname)) return null;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return (await checkAccess(request, env)) ? null : deny(403, 'Acceso denegado.');
  }
  if (!env.FINTRACK_PASSWORD) {
    return deny(503, 'El Worker no tiene protección configurada (falta FINTRACK_PASSWORD). No atiendo nada hasta que la cargues.');
  }
  if (url.pathname === '/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/logout') return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  if ((await checkSession(request, env.FINTRACK_PASSWORD)) || (await checkBasic(request, env.FINTRACK_PASSWORD))) return null;
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, error: 'login' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return loginPage();
}

function deny(status, msg) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

// ── Sesión con cookie firmada (HMAC con una clave derivada de la contraseña) ──
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(password, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`fintrack-session:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function checkSession(request, password) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ft_s=([\w.-]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(password, exp));
}
async function login(request, env) {
  const form = await request.formData().catch(() => null);
  const pass = String(form?.get('password') || '');
  if (!(await safeEqual(pass, env.FINTRACK_PASSWORD))) {
    await new Promise(r => setTimeout(r, 1200)); // frena los intentos al azar
    return loginPage('Esa no es. Probá de nuevo.');
  }
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400);
  const value = `${exp}.${await hmac(env.FINTRACK_PASSWORD, exp)}`;
  return new Response(null, {
    status: 303,
    headers: { location: '/', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` },
  });
}
function loginPage(error = '') {
  // 401 a propósito: así el service worker no la guarda como si fuera la app
  return new Response(`<!DOCTYPE html><html lang="es-AR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="FinTrack"><meta name="theme-color" content="#0B0C0F">
<link rel="apple-touch-icon" href="/icon-180.png"><link rel="manifest" href="/manifest.webmanifest"><title>FinTrack</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0B0C0F;color:#EEEAE2;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}.b{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.b span{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:3px}h1{font-family:Georgia,serif;font-weight:400;font-size:32px;margin:0 0 6px}
input{height:52px;border:1px solid #2E313A;border-radius:3px;background:transparent;color:#EEEAE2;font-size:17px;padding:0 14px;outline:none}input:focus{border-color:#C9C5BD}
button{height:52px;border:0;border-radius:3px;background:#4157FF;color:#fff;font-size:16px;font-weight:500}.e{color:#E07A86;font-size:14px}</style></head>
<body><form method="post" action="/login"><div class="b"><svg width="30" height="30" viewBox="0 0 30 30" fill="none"><rect width="30" height="30" rx="3" fill="#4157FF"/><path d="M9 23V7h12M9 14.5h8" stroke="#EEEAE2" stroke-width="2.6" stroke-linecap="square"/><path d="M13 23l5-5 2.5 2.5L25 15" stroke="#EEEAE2" stroke-width="1.6" stroke-linecap="square"/></svg><span>FINTRACK</span></div>
<h1>Hola de nuevo</h1>
<input type="text" name="username" value="rodrigo" autocomplete="username" hidden>
<input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" autofocus required>
${error ? `<div class="e">${error}</div>` : ''}<button type="submit">Entrar</button></form></body></html>`, {
    status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ── Basic Auth (para scripts) ─────────────────────────────────
async function checkBasic(request, expected) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0)));
  } catch {
    return false;
  }
  return safeEqual(decoded.slice(decoded.indexOf(':') + 1), expected);
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
