// FinTrack · Worker: sirve la app (worker/public), la API (/api/*) y sincroniza con Mercado Pago.
// Todo pasa por authorize(): sin protección configurada no se atiende nada.

import { authorize } from './auth.js';
import { handleApi } from './api.js';
import { ensureSchema } from './db.js';
import { runSync } from './sync.js';

export default {
  async fetch(request, env) {
    const denied = await authorize(request, env);
    if (denied) return denied;

    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, pathname);
      } catch (e) {
        console.error('api', pathname, e?.message);
        return new Response(JSON.stringify({ ok: false, error: 'Error interno.' }), {
          status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    }
    if (!env.ASSETS) return new Response('Sin app.', { status: 404 });
    const res = await env.ASSETS.fetch(request);
    // El HTML y el service worker nunca desde caché del navegador: así el iPhone ve la versión nueva
    if (/\.(html|js|webmanifest)$|\/$/.test(pathname)) {
      const fresh = new Response(res.body, res);
      fresh.headers.set('cache-control', 'no-cache');
      return fresh;
    }
    return res;
  },

  // Cron: cada 2 horas
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      const r = await runSync(env, env.DB);
      if (!r.ok) console.error('sync', r.errors);
    })());
  },
};
