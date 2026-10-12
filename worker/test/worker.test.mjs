// Pruebas del Worker con Mercado Pago simulado. Correr con: node --test worker/test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const ME = 111;
let calls = [];
let routes = {};

beforeEach(() => {
  calls = [];
  routes = {
    '/users/me': [200, { id: ME, site_id: 'MLA', user_type: 'normal' }],
    // Forma real: cuando pagaste vos, MP manda payer_id (sin objeto payer) y el destinatario en collector
    '/v1/payments/search?payer': [200, { paging: { total: 3 }, results: [
      { id: 1, payer_id: ME, collector: { id: 999, first_name: 'Hormiga Negra', last_name: 'Olivos', email: 'x@y.com' }, transaction_amount: 18740,
        currency_id: 'ARS', operation_type: 'regular_payment', description: 'Hormiga negra olivos', status: 'approved',
        date_created: '2026-10-12T10:52:00.000-04:00', date_approved: '2026-10-12T10:52:05.000-04:00' },
      { id: 3, payer_id: ME, collector: { id: 998 }, transaction_amount: 2790, currency_id: 'ARS', operation_type: 'regular_payment',
        description: 'Payu*ar*uber', status: 'cancelled', date_created: '2026-10-12T09:00:00.000-04:00' },
      { id: 4, payer_id: ME, collector: { id: 997, email: 'amigo@mail.com' }, transaction_amount: 1400, currency_id: 'ARS',
        operation_type: 'money_transfer', description: 'Varios', status: 'approved', date_created: '2026-10-10T23:30:00.000-04:00' },
    ] }],
    '/v1/payments/search?collector': [200, { paging: { total: 1 }, results: [
      { id: 2, payer: { id: 555, first_name: 'Juan', last_name: 'Pérez' }, collector_id: ME, transaction_amount: 5000, currency_id: 'ARS',
        operation_type: 'money_transfer', status: 'approved', date_created: '2026-10-11T09:00:00.000-03:00' },
    ] }],
    '/mercadopago_account/movements/search': [200, { paging: { total: 2 }, results: [
      { id: 70, reference_id: 1, amount: -18740, currency_id: 'ARS', date_created: '2026-10-12T11:52:00.000-03:00', concept_type: 'payment' },
      // 12/10 00:30 en -03:00 = 11/10 23:30 en -04:00: como texto parece más nuevo que pay_1, pero es anterior
      { id: 71, amount: 3412.5, currency_id: 'ARS', date_created: '2026-10-12T00:30:00.000-03:00', detail: 'Rendimientos' },
    ] }],
    '/v1/orders': [403, { error: 'forbidden', message: 'not allowed' }],
    [`/users/${ME}/mercadopago_account/balance`]: [404, { message: 'not found' }],
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    let key = url.pathname;
    if (key === '/v1/payments/search') key += url.searchParams.has('payer.id') ? '?payer' : '?collector';
    const [status, body] = routes[key] || [404, {}];
    return new Response(JSON.stringify(body), { status });
  };
});

const env = { MP_ACCESS_TOKEN: 'APP_USR-secreto', FINTRACK_PASSWORD: 'clave-larga' };
const basic = pass => ({ authorization: 'Basic ' + btoa('rodrigo:' + pass) });
const get = (path, headers = {}, e = env) => worker.fetch(new Request('https://x.workers.dev' + path, { headers }), e);

test('sin protección configurada no atiende nada', async () => {
  const r = await get('/test', {}, { MP_ACCESS_TOKEN: 'x' });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test('sin contraseña o con contraseña mala pide credenciales', async () => {
  for (const h of [{}, basic('mala')]) {
    const r = await get('/test', h);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /Basic/);
  }
  assert.equal(calls.length, 0);
});

test('/test normaliza, deduplica y reporta cada fuente', async () => {
  const r = await get('/test', basic('clave-larga'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const d = await r.json();
  assert.equal(d.ok, true);
  // Pago hecho: negativo, con descripción; el movimiento duplicado (reference_id 1) no aparece dos veces
  // El cancelado (pay_3) no cuenta como movimiento
  const ids = d.movimientos.map(m => m.id);
  assert.deepEqual(ids, ['pay_1', 'mov_71', 'pay_2', 'pay_4']);
  assert.equal(d.descartados, 1);
  const [hormiga, rendim, juan, transf] = d.movimientos;
  assert.equal(hormiga.monto, -18740);
  assert.equal(hormiga.sentido, 'sale');
  assert.equal(hormiga.contraparte, 'Hormiga Negra Olivos');
  assert.equal(juan.sentido, 'entra');
  assert.equal(juan.contraparte, 'Juan Pérez');
  assert.equal(rendim.descripcion, 'Rendimientos');
  assert.equal(transf.monto, -1400);
  assert.equal(transf.contraparte, 'amigo@mail.com');
  // 23:30 en -04:00 ya es el día siguiente en Argentina
  assert.equal(transf.dia, '2026-10-11');
  assert.equal(d.fuentes.orders.ok, false);
  assert.equal(d.fuentes.saldo.ok, false);
  assert.equal(d.saldo.disponible, false);
  // Solo GET a Mercado Pago y el token nunca aparece en la respuesta
  assert.ok(calls.every(c => !c.init?.method || c.init.method === 'GET'));
  assert.ok(!JSON.stringify(d).includes('APP_USR'));
});

test('token inválido da un error claro', async () => {
  routes['/users/me'] = [401, { message: 'invalid_token' }];
  const d = await (await get('/test', basic('clave-larga'))).json();
  assert.equal(d.ok, false);
  assert.match(d.error, /token no anda/);
});

test('solo acepta GET', async () => {
  const r = await worker.fetch(new Request('https://x.workers.dev/test', { method: 'POST', headers: basic('clave-larga') }), env);
  assert.equal(r.status, 405);
});
