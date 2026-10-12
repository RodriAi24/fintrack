// FinTrack · Worker de la API
// Etapa 0: /test prueba todas las fuentes de Mercado Pago, normaliza lo que responda
// y devuelve los últimos 20 movimientos, el saldo (si se puede) y un diagnóstico por fuente.

import { authorize } from './auth.js';
import { mpGet, normalizePayment, normalizeMovement, normalizeOrder, fieldNames, NOT_A_MOVEMENT } from './mp.js';
import { settlementReport } from './report.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const denied = await authorize(request, env);
    if (denied) return denied;

    const { pathname } = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'Solo GET.' }, 405);
    if (pathname === '/') return json({ app: 'FinTrack API', endpoints: ['/test', '/reporte', '/detalle?id='] });
    if (pathname === '/test') return json(await test(env));
    if (pathname === '/detalle') {
      // Diagnóstico: qué sabe MP de un movimiento puntual (ej.: un PAYOUT del reporte)
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!/^\d{6,20}$/.test(id)) return json({ ok: false, error: 'Pasá ?id= con el número de operación.' }, 400);
      if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: 'Falta el secret MP_ACCESS_TOKEN en Cloudflare.' });
      const r = await mpGet(env, `/v1/payments/${id}`);
      return json(r.http === 200
        ? { ok: true, http: 200, campos: fieldNames(r.body), pago: r.body }
        : { ok: false, http: r.http, error: r.error });
    }
    if (pathname === '/reporte') {
      if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: 'Falta el secret MP_ACCESS_TOKEN en Cloudflare.' });
      return json(await settlementReport(env));
    }
    return json({ error: 'No existe.' }, 404);
  },
};

async function test(env) {
  if (!env.MP_ACCESS_TOKEN) {
    return { ok: false, error: 'Falta el secret MP_ACCESS_TOKEN en Cloudflare.' };
  }

  const me = await mpGet(env, '/users/me');
  if (me.http !== 200) {
    return { ok: false, error: `El token no anda (${me.error}). Revisá que sea el Access Token de producción.` };
  }
  const myId = me.body.id;

  const now = new Date();
  const daysAgo = d => new Date(now.getTime() - d * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const paySearch = role => mpGet(env, '/v1/payments/search', {
    [`${role}.id`]: myId, sort: 'date_created', criteria: 'desc', range: 'date_created',
    begin_date: 'NOW-90DAYS', end_date: 'NOW', limit: 50,
  });

  const [asPayer, asCollector, movements, orders, balance] = await Promise.all([
    paySearch('payer'),
    paySearch('collector'),
    mpGet(env, '/mercadopago_account/movements/search', { limit: 30, offset: 0, sort: 'date_created', criteria: 'desc' }),
    mpGet(env, '/v1/orders', { begin_date: daysAgo(30), end_date: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), page: 1, page_size: 20, sort_by: 'created_date', sort_order: 'desc' }),
    mpGet(env, `/users/${myId}/mercadopago_account/balance`),
  ]);

  const list = (r, key = 'results') => (r.http === 200 && Array.isArray(r.body?.[key]) ? r.body[key] : []);
  const payerItems = list(asPayer), collectorItems = list(asCollector);
  const movItems = list(movements), orderItems = list(orders, 'data');

  // Unificar y deduplicar: un pago puede venir por payments y por movements
  const byId = new Map();
  for (const p of [...payerItems, ...collectorItems]) byId.set(`pay_${p.id}`, normalizePayment(p, myId));
  for (const m of movItems) {
    const n = normalizeMovement(m);
    if (n.ref && byId.has(n.ref)) continue;
    byId.set(n.id, n);
  }
  for (const o of orderItems) byId.set(`ord_${o.id}`, normalizeOrder(o));
  const all = [...byId.values()];
  const movimientos = all
    .filter(m => m.fecha && !NOT_A_MOVEMENT.has(m.estado))
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))
    .slice(0, 20);

  const diag = (r, items, extra = {}) => ({
    http: r.http,
    ok: r.http === 200,
    ...(r.error ? { error: r.error } : {}),
    ...(r.http === 200 ? { total: r.body?.paging?.total ?? items.length, recibidos: items.length } : {}),
    ...(items[0] ? { campos: fieldNames(items[0]) } : {}),
    ...extra,
  });

  return {
    ok: true,
    generado: now.toISOString(),
    cuenta: { pais: me.body.site_id, tipo: me.body.user_type },
    saldo: balance.http === 200 ? balance.body : { disponible: false, motivo: balance.error },
    movimientos,
    descartados: all.filter(m => NOT_A_MOVEMENT.has(m.estado)).length,
    fuentes: {
      pagos_que_hiciste: diag(asPayer, payerItems, { endpoint: 'GET /v1/payments/search?payer.id=yo' }),
      pagos_que_recibiste: diag(asCollector, collectorItems, { endpoint: 'GET /v1/payments/search?collector.id=yo' }),
      movimientos_de_cuenta: diag(movements, movItems, { endpoint: 'GET /mercadopago_account/movements/search (no documentado)' }),
      orders: diag(orders, orderItems, { endpoint: 'GET /v1/orders (cobros de tu integración)' }),
      saldo: { http: balance.http, ok: balance.http === 200, endpoint: 'GET /users/{id}/mercadopago_account/balance (no documentado)', ...(balance.error ? { error: balance.error } : {}) },
    },
  };
}
