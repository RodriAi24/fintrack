// Cliente de Binance de SOLO LECTURA (clave con "Enable Reading" únicamente).
// Firma HMAC-SHA256 de la query, como pide Binance. Nunca se llama a endpoints de órdenes ni retiros.

const API = 'https://api.binance.com';
const DAYS = 30;
const enc = new TextEncoder();

async function sign(secret, query) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(query));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bnRequest(env, method, path, params = {}) {
  const query = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const signature = await sign(env.BINANCE_API_SECRET, query);
  let res;
  try {
    res = await fetch(`${API}${path}?${query}&signature=${signature}`, {
      method,
      headers: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
    });
  } catch {
    return { http: 0, body: null, error: 'sin conexión con Binance' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* sin JSON */
  }
  let error = null;
  if (res.status === 451) error = 'Binance bloquea pedidos desde esta ubicación (451)';
  else if (!res.ok) error = [body?.code, body?.msg].filter(v => v !== undefined).join(' · ').slice(0, 200) || `HTTP ${res.status}`;
  return { http: res.status, body, error };
}

const num = v => Number(v || 0);
const sinceMs = () => Date.now() - DAYS * 86400_000;

export async function binanceProbe(env, colo) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) {
    return { ok: false, error: 'Faltan los secrets BINANCE_API_KEY y BINANCE_API_SECRET en Cloudflare.' };
  }
  const start = String(sinceMs());
  const end = String(Date.now());
  const calls = {
    spot: bnRequest(env, 'GET', '/api/v3/account', { omitZeroBalances: 'true' }),
    funding: bnRequest(env, 'POST', '/sapi/v1/asset/get-funding-asset'),
    earn_flexible: bnRequest(env, 'GET', '/sapi/v1/simple-earn/flexible/position', { size: '100' }),
    earn_locked: bnRequest(env, 'GET', '/sapi/v1/simple-earn/locked/position', { size: '100' }),
    depositos: bnRequest(env, 'GET', '/sapi/v1/capital/deposit/hisrec', { startTime: start, endTime: end }),
    retiros: bnRequest(env, 'GET', '/sapi/v1/capital/withdraw/history', { startTime: start, endTime: end }),
    binance_pay: bnRequest(env, 'GET', '/sapi/v1/pay/transactions', { startTime: start, endTime: end, limit: '100' }),
    p2p_ventas: bnRequest(env, 'GET', '/sapi/v1/c2c/orderMatch/listUserOrderHistory', { tradeType: 'SELL', startTimestamp: start, endTimestamp: end }),
    p2p_compras: bnRequest(env, 'GET', '/sapi/v1/c2c/orderMatch/listUserOrderHistory', { tradeType: 'BUY', startTimestamp: start, endTimestamp: end }),
    earn_rendimientos: bnRequest(env, 'GET', '/sapi/v1/simple-earn/flexible/history/rewardsRecord', { type: 'REALTIME', startTime: start, endTime: end, size: '100' }),
  };
  const keys = Object.keys(calls);
  const results = Object.fromEntries((await Promise.all(Object.values(calls))).map((r, i) => [keys[i], r]));
  const ok = k => results[k].http === 200;

  // Saldos por billetera y activo
  const saldos = {};
  const add = (wallet, asset, amount) => {
    if (!amount) return;
    saldos[asset] ||= { total: 0 };
    saldos[asset][wallet] = (saldos[asset][wallet] || 0) + amount;
    saldos[asset].total += amount;
  };
  if (ok('spot')) for (const b of results.spot.body.balances || []) add('spot', b.asset, num(b.free) + num(b.locked));
  if (ok('funding')) for (const b of results.funding.body || []) add('funding', b.asset, num(b.free) + num(b.locked) + num(b.freeze) + num(b.withdrawing));
  if (ok('earn_flexible')) for (const p of results.earn_flexible.body.rows || []) add('earn', p.asset, num(p.totalAmount));
  if (ok('earn_locked')) for (const p of results.earn_locked.body.rows || []) add('earn_bloqueado', p.asset, num(p.amount));

  // Movimientos normalizados (monto positivo = entra a Binance)
  const mov = [];
  const push = m => mov.push({ ...m, fecha: new Date(Number(m.fecha)).toISOString() });
  if (ok('depositos')) for (const d of results.depositos.body || []) {
    if (Number(d.status) === 1) push({ id: `bn_dep_${d.id || d.txId}`, fecha: d.insertTime, tipo: 'depósito', monto: num(d.amount), activo: d.coin, red: d.network, contraparte: null });
  }
  if (ok('retiros')) for (const w of results.retiros.body || []) {
    push({ id: `bn_ret_${w.id}`, fecha: Date.parse(String(w.applyTime).replace(' ', 'T') + 'Z') || Date.now(), tipo: 'retiro', monto: -num(w.amount), activo: w.coin, red: w.network, contraparte: null, estado: w.status });
  }
  if (ok('binance_pay')) for (const t of results.binance_pay.body?.data || []) {
    const amt = num(t.amount);
    push({ id: `bn_pay_${t.transactionId}`, fecha: t.transactionTime, tipo: 'binance pay', monto: amt, activo: t.currency,
      contraparte: (amt >= 0 ? t.payerInfo?.name : t.receiverInfo?.name) || null, detalle: t.orderType });
  }
  for (const side of ['p2p_ventas', 'p2p_compras']) {
    if (!ok(side)) continue;
    for (const o of results[side].body?.data || []) {
      if (o.orderStatus !== 'COMPLETED') continue;
      const sell = o.tradeType === 'SELL';
      push({ id: `bn_p2p_${o.orderNumber}`, fecha: o.createTime, tipo: sell ? 'venta P2P' : 'compra P2P',
        monto: sell ? -num(o.amount) : num(o.amount), activo: o.asset,
        contraparte: o.counterPartNickName || null, detalle: `${o.totalPrice} ${o.fiat} a ${o.unitPrice}` });
    }
  }
  if (ok('earn_rendimientos')) for (const r of results.earn_rendimientos.body?.rows || []) {
    push({ id: `bn_earn_${r.asset}_${r.time}`, fecha: r.time, tipo: 'rendimiento Earn', monto: num(r.rewards), activo: r.asset, contraparte: null });
  }
  mov.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));

  const fuentes = Object.fromEntries(keys.map(k => [k, {
    http: results[k].http, ok: ok(k), ...(results[k].error ? { error: results[k].error } : {}),
  }]));
  const blocked = Object.values(results).some(r => r.http === 451);

  return {
    ok: !blocked && Object.values(fuentes).some(f => f.ok),
    ubicacion_worker: colo || null,
    ...(blocked ? { aviso: 'Binance rechazó el pedido por la ubicación desde la que salió el Worker. Hay que forzar otra región o usar un proxy.' } : {}),
    saldos,
    movimientos_30_dias: mov,
    fuentes,
  };
}
