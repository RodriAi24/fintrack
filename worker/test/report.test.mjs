// Pruebas de /reporte (settlement report) con Mercado Pago simulado. Correr con: node --test worker/test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { parseCsv } from '../src/report.js';

let calls, routes;
const env = { MP_ACCESS_TOKEN: 'APP_USR-secreto', FINTRACK_PASSWORD: 'clave-larga' };
const auth = { authorization: 'Basic ' + btoa('rodrigo:clave-larga') };
const get = path => worker.fetch(new Request('https://x.workers.dev' + path, { headers: auth }), env);

beforeEach(() => {
  calls = [];
  routes = {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const key = `${init.method || 'GET'} ${url.pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const [status, body, isText] = routes[key] || [404, { message: 'not found' }];
    return new Response(isText ? body : JSON.stringify(body), { status });
  };
});

test('primera vez: crea la configuración y pide el reporte', async () => {
  routes['GET /v1/account/settlement_report/config'] = [404, { message: 'not found' }];
  routes['POST /v1/account/settlement_report/config'] = [201, {}];
  routes['GET /v1/account/settlement_report/list'] = [200, []];
  routes['POST /v1/account/settlement_report'] = [202, {}];
  const d = await (await get('/reporte')).json();
  assert.equal(d.ok, true);
  assert.equal(d.estado, 'generando');
  assert.equal(d.configuracion_creada, true);
  const cfg = calls.find(c => c.key === 'POST /v1/account/settlement_report/config').body;
  assert.equal(cfg.include_withdraw, true);
  assert.ok(cfg.columns.some(c => c.key === 'TRANSACTION_TYPE'));
  const asked = calls.find(c => c.key === 'POST /v1/account/settlement_report').body;
  assert.ok(Date.parse(asked.end_date) - Date.parse(asked.begin_date) > 29 * 86400_000);
});

test('con un reporte reciente: lo descarga, resume y no pide otro', async () => {
  const csv = [
    'TRANSACTION_DATE;SOURCE_ID;TRANSACTION_TYPE;SETTLEMENT_NET_AMOUNT;SETTLEMENT_CURRENCY;PAYMENT_METHOD_TYPE;DESCRIPTION;PAYER_NAME',
    '2026-10-08T11:06:00.000-03:00;111;WITHDRAWAL;-268833.81;ARS;;"Presidente Peron 7080; 07 A";',
    '2026-10-07T19:30:59.000-03:00;222;SETTLEMENT;1190000;ARS;account_money;Varios;Nahuel C',
  ].join('\r\n');
  routes['GET /v1/account/settlement_report/config'] = [200, { file_name_prefix: 'fintrack' }];
  routes['GET /v1/account/settlement_report/list'] = [200, [
    { file_name: 'fintrack-viejo.csv', date_created: '2020-01-01T00:00:00Z' },
    { file_name: 'fintrack-nuevo.csv', date_created: new Date().toISOString(), begin_date: 'a', end_date: 'b' },
  ]];
  routes['GET /v1/account/settlement_report/fintrack-nuevo.csv'] = [200, csv, true];
  const d = await (await get('/reporte')).json();
  assert.equal(d.estado, 'listo');
  assert.equal(d.filas, 2);
  assert.deepEqual(d.por_tipo, { WITHDRAWAL: 1, SETTLEMENT: 1 });
  assert.equal(d.movimientos[0].monto, -268833.81);
  assert.equal(d.movimientos[0].descripcion, 'Presidente Peron 7080; 07 A');
  assert.equal(d.movimientos[1].contraparte, 'Nahuel C');
  assert.ok(!calls.some(c => c.key === 'POST /v1/account/settlement_report'));
  assert.ok(!calls.some(c => c.key.startsWith('POST') && c.key.endsWith('/config')));
});

test('si MP rechaza un paso, lo dice sin romper', async () => {
  routes['GET /v1/account/settlement_report/config'] = [403, { message: 'forbidden' }];
  const d = await (await get('/reporte')).json();
  assert.equal(d.ok, false);
  assert.equal(d.paso, 'leer configuración');
  assert.equal(d.http, 403);
});

test('parseCsv: comillas, separador y saltos de línea', () => {
  const rows = parseCsv('﻿A,B\n"x, y","con ""comillas"""\n\n1,2\n');
  assert.deepEqual(rows, [{ A: 'x, y', B: 'con "comillas"' }, { A: '1', B: '2' }]);
});
