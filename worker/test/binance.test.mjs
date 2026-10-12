// Pruebas de /binance con Binance simulado. Correr con: node --test worker/test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';

let calls, routes;
const env = { FINTRACK_PASSWORD: 'clave-larga', BINANCE_API_KEY: 'k-123', BINANCE_API_SECRET: 's-456' };
const auth = { authorization: 'Basic ' + btoa('rodrigo:clave-larga') };
const get = (path, e = env) => worker.fetch(new Request('https://x.workers.dev' + path, { headers: auth }), e);
const now = Date.now();

beforeEach(() => {
  calls = [];
  routes = {
    'GET /api/v3/account': [200, { balances: [{ asset: 'USDC', free: '100.5', locked: '0' }, { asset: 'BNB', free: '0.01', locked: '0' }] }],
    'POST /sapi/v1/asset/get-funding-asset': [200, [{ asset: 'USDC', free: '20', locked: '0', freeze: '0', withdrawing: '0' }]],
    'GET /sapi/v1/simple-earn/flexible/position': [200, { rows: [{ asset: 'USDC', totalAmount: '1000' }], total: 1 }],
    'GET /sapi/v1/simple-earn/locked/position': [200, { rows: [], total: 0 }],
    'GET /sapi/v1/capital/deposit/hisrec': [200, [{ id: 'd1', amount: '300', coin: 'USDC', network: 'SOL', status: 1, insertTime: now - 5000 }]],
    'GET /sapi/v1/capital/withdraw/history': [200, []],
    'GET /sapi/v1/pay/transactions': [200, { code: '000000', data: [{ transactionId: 'p1', transactionTime: now - 1000, amount: '50', currency: 'USDC', orderType: 'C2C', payerInfo: { name: 'Cliente SA' } }] }],
    'GET /sapi/v1/c2c/orderMatch/listUserOrderHistory?SELL': [200, { data: [{ orderNumber: 'o1', tradeType: 'SELL', asset: 'USDC', fiat: 'ARS', amount: '100', totalPrice: '150000', unitPrice: '1500', orderStatus: 'COMPLETED', createTime: now - 3000, counterPartNickName: 'comprador1' }] }],
    'GET /sapi/v1/c2c/orderMatch/listUserOrderHistory?BUY': [200, { data: [] }],
    'GET /sapi/v1/simple-earn/flexible/history/rewardsRecord': [200, { rows: [{ asset: 'USDC', rewards: '0.12', time: now - 2000 }], total: 1 }],
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    let key = `${init.method || 'GET'} ${url.pathname}`;
    if (url.pathname.includes('listUserOrderHistory')) key += '?' + url.searchParams.get('tradeType');
    const [status, body] = routes[key] || [404, { code: -1, msg: 'not found' }];
    return new Response(JSON.stringify(body), { status });
  };
});

test('sin secrets de Binance avisa claro y no llama a nadie', async () => {
  const d = await (await get('/binance', { FINTRACK_PASSWORD: 'clave-larga' })).json();
  assert.equal(d.ok, false);
  assert.match(d.error, /BINANCE_API_KEY/);
  assert.equal(calls.length, 0);
});

test('firma cada pedido con HMAC-SHA256 de la query y manda la API key en el header', async () => {
  await get('/binance');
  assert.ok(calls.length >= 10);
  for (const { url, init } of calls) {
    const sig = url.searchParams.get('signature');
    const query = url.search.slice(1).replace(/&signature=[0-9a-f]+$/, '');
    assert.equal(sig, createHmac('sha256', 's-456').update(query).digest('hex'));
    assert.equal(init.headers['X-MBX-APIKEY'], 'k-123');
    assert.ok(url.searchParams.get('timestamp'));
    // Nada de órdenes ni retiros
    assert.ok(!/\/api\/v3\/order|\/capital\/withdraw\/apply|\/asset\/transfer/.test(url.pathname), url.pathname);
  }
});

test('suma saldos por billetera y normaliza movimientos', async () => {
  const d = await (await get('/binance')).json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.saldos.USDC, { total: 1120.5, spot: 100.5, funding: 20, earn: 1000 });
  const tipos = d.movimientos_30_dias.map(m => m.tipo);
  assert.deepEqual(tipos, ['binance pay', 'rendimiento Earn', 'venta P2P', 'depósito']);
  const venta = d.movimientos_30_dias.find(m => m.tipo === 'venta P2P');
  assert.equal(venta.monto, -100);
  assert.match(venta.detalle, /150000 ARS/);
  assert.equal(d.movimientos_30_dias[0].contraparte, 'Cliente SA');
});

test('si Binance bloquea por ubicación (451) lo dice', async () => {
  for (const k of Object.keys(routes)) routes[k] = [451, { code: 0, msg: 'Service unavailable from a restricted location' }];
  const d = await (await get('/binance')).json();
  assert.equal(d.ok, false);
  assert.match(d.aviso, /ubicación/);
  assert.match(d.fuentes.spot.error, /451/);
});
