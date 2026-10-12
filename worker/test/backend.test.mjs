// Pruebas del backend (sin red ni base real). Correr con: node --test worker/test/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { parseCsv, reportToMovements } from '../src/report.js';
import { classify, merchantKey } from '../src/classify.js';
import { normalizePayment } from '../src/mp.js';

const get = (path, headers = {}, env = {}) => worker.fetch(new Request('https://x.workers.dev' + path, { headers }), env);

test('sin protección configurada no atiende nada', async () => {
  assert.equal((await get('/api/state')).status, 503);
});

test('con contraseña mala no entra', async () => {
  const r = await get('/api/state', { authorization: 'Basic ' + btoa('x:mala') }, { FINTRACK_PASSWORD: 'buena' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'login');
});

test('login: sin sesión muestra el login, con la contraseña deja una cookie que dura y sirve', async () => {
  const env = { FINTRACK_PASSWORD: 'buena' };
  const page = await get('/', {}, env);
  assert.equal(page.status, 401);
  assert.match(await page.text(), /<form method="post" action="\/login">/);
  const post = pass => worker.fetch(new Request('https://x.workers.dev/login', { method: 'POST', body: new URLSearchParams({ password: pass }) }), env);
  const bad = await post('mala');
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  const ok = await post('buena');
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /ft_s=\d+\.[\w-]+; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax/);
  const session = cookie.split(';')[0];
  // Con la cookie pasa la protección (sin base, la API responde 500 de "falta DB": no 401)
  assert.notEqual((await get('/api/state', { cookie: session }, env)).status, 401);
  // Cookie adulterada o firmada con otra contraseña: afuera
  assert.equal((await get('/api/state', { cookie: session.replace(/.$/, 'x') }, env)).status, 401);
  assert.equal((await get('/api/state', { cookie: session }, { FINTRACK_PASSWORD: 'otra' })).status, 401);
});

test('los íconos y el manifest son públicos (iOS los pide sin sesión)', async () => {
  const env = { FINTRACK_PASSWORD: 'buena' };
  for (const p of ['/icon-180.png', '/icon.svg', '/manifest.webmanifest']) assert.notEqual((await get(p, {}, env)).status, 401);
  assert.equal((await get('/app.js', {}, env)).status, 401);
});

test('parseCsv: comillas, separador y saltos de línea', () => {
  assert.deepEqual(parseCsv('﻿A,B\n"x, y","con ""comillas"""\n\n1,2\n'), [{ A: 'x, y', B: 'con "comillas"' }, { A: '1', B: '2' }]);
});

test('reporte: separa rendimientos de disponible y reserva, payouts y devoluciones', () => {
  const rows = parseCsv([
    'TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;SETTLEMENT_NET_AMOUNT;PAYMENT_METHOD;PAYMENT_METHOD_TYPE;PAYER_NAME;EXTERNAL_REFERENCE',
    '2026-10-09T03:10:03.000-03:00;175;SETTLEMENT;133.73;;;;',
    '2026-10-09T03:10:03.000-03:00;175;SETTLEMENT;293.39;;;;',
    '2026-10-08T11:07:03.000-03:00;182;PAYOUTS;-268833.81;;;;',
    '2026-10-09T11:21:00.000-03:00;181;REFUND;229;available_money;available_money;;abc',
    '2026-10-02T08:52:22.000-03:00;190;SETTLEMENT;1700000;debin_transfer;bank_transfer;;',
  ].join('\n'));
  // Reserva de $255.261 al 19%: rinde ~133 por día
  const movs = reportToMovements(rows, { reserve: { balance: 255261, rate: 19 } });
  const yields = movs.filter(m => m.op === 'rendimiento');
  assert.equal(yields.find(m => m.pocket === 'reserva').amount, 133.73);
  assert.equal(yields.find(m => m.pocket === 'mp').amount, 293.39);
  assert.equal(movs.find(m => m.op === 'payout').amount, -268833.81);
  assert.equal(movs.find(m => m.op === 'refund').linked_id, 'pay_181');
  assert.equal(classify(movs.find(m => m.id === 'pay_190'), {}).kind, 'interno');
});

test('plata entre cuentas propias (vos pagás y vos cobrás) no es ingreso ni toca el saldo', () => {
  const self = normalizePayment({ id: 9, payer_id: 7, collector_id: 7, transaction_amount: 5000000, currency_id: 'ARS', operation_type: 'money_transfer', status: 'approved', date_created: '2026-07-01T10:00:00.000-04:00' }, 7);
  assert.equal(self.direction, 'interno');
  assert.equal(self.pocket, null);
  assert.equal(classify(self).kind, 'interno');
  const foreign = normalizePayment({ id: 10, payer_id: 1, collector_id: 2, transaction_amount: 100, status: 'approved', date_created: '2026-07-01T10:00:00.000-04:00' }, 7);
  assert.equal(classify(foreign).kind, 'descartado');
  assert.equal(classify({ amount: -605671.54, op: 'regular_payment', description: 'Swissmedicalgroup' }).category, 'salud');
});

test('clasificación: comercios, transferencias y reglas propias', () => {
  const uber = normalizePayment({ id: 1, payer_id: 9, collector: { id: 2 }, transaction_amount: 2806, currency_id: 'ARS', operation_type: 'regular_payment', description: 'Payu*ar*uber', status: 'approved', payment_type_id: 'prepaid_card', date_created: '2026-10-07T21:07:33.000-04:00' }, 9);
  assert.equal(uber.amount, -2806);
  assert.equal(uber.day, '2026-10-07');
  assert.equal(uber.pocket, 'mp');
  assert.equal(classify(uber).category, 'transporte');
  assert.equal(merchantKey(uber), 'uber');
  const termo = normalizePayment({ id: 3, payer_id: 9, collector: { id: 4 }, transaction_amount: 139000, operation_type: 'regular_payment', description: 'Termo Stanley Clasico 950ml Con Tapón Cebador', status: 'approved', payment_type_id: 'credit_card', date_created: '2026-10-04T01:50:12.000-04:00' }, 9);
  assert.equal(termo.pocket, 'externo'); // con tarjeta: no sale del saldo de MP
  assert.equal(classify(termo).category, 'compras');
  const transfer = { amount: -19000, op: 'money_transfer', description: 'Varios', counterparty: 'Diego Oranges' };
  assert.equal(classify(transfer).review, 1);
  const withRule = classify(transfer, { rules: [{ pattern: 'diego oranges', category: 'salidas', kind: 'gasto' }] });
  assert.equal(withRule.category, 'salidas');
  assert.equal(withRule.review, 0);
  assert.equal(classify({ ...transfer, status: 'cancelled' }).kind, 'descartado');
});
