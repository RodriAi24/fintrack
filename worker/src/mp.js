// Cliente de Mercado Pago + normalización de pagos.
// Nada acá crea pagos, reembolsos ni transferencias. La única escritura es pedir reportes,
// que no mueve plata.

const API = 'https://api.mercadopago.com';

async function mpRequest(env, method, path, { params, body, text = false } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const headers = { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { http: 0, body: null, error: 'sin conexión con Mercado Pago' };
  }
  const raw = await res.text();
  let parsed = null;
  if (!text) {
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* respuesta sin JSON */
    }
  }
  const error = res.ok ? null : [parsed?.error, parsed?.message].filter(Boolean).join(' · ').slice(0, 200) || `HTTP ${res.status}`;
  return { http: res.status, body: text ? raw : parsed, error };
}

export const mpGet = (env, path, params) => mpRequest(env, 'GET', path, { params });
export const mpGetText = (env, path) => mpRequest(env, 'GET', path, { text: true });
export const mpPost = (env, path, body) => mpRequest(env, 'POST', path, { body });

// Estados que no movieron plata
export const NOT_A_MOVEMENT = new Set(['cancelled', 'rejected', 'pending', 'in_process', 'authorized']);

// Día calendario en Argentina (MP devuelve fechas en -04:00)
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
export function localDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dayFmt.format(d);
}

const round = n => Math.round(Number(n || 0) * 100) / 100;
const fullName = p => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || null;

// Medios que salen del saldo de Mercado Pago (la prepaga también)
const FROM_MP_BALANCE = new Set(['account_money', 'available_money', 'prepaid_card']);

// Pago de /v1/payments/search → movimiento crudo (sin clasificar).
// Cuando pagaste vos, MP manda `payer_id` (sin objeto payer) y el destinatario en `collector`;
// cuando cobraste, manda el objeto `payer` y `collector_id`.
export function normalizePayment(p, myId) {
  const payerId = p.payer?.id ?? p.payer_id;
  const collectorId = p.collector_id ?? p.collector?.id;
  const iPaid = String(payerId ?? '') === String(myId);
  const iCollected = String(collectorId ?? '') === String(myId);
  const amount = round(p.transaction_amount);
  const refunded = round(p.transaction_amount_refunded);
  // Vos de los dos lados = plata entre tus propias cuentas (reserva, dinero que rinde, dólares,
  // inversiones). MP los registra como pagos y pasan muchas veces por día: NO son ingresos.
  const direction = iPaid && iCollected ? 'interno' : iPaid ? 'sale' : iCollected ? 'entra' : 'ajeno';
  // date_created = cuándo lo hiciste (lo que muestra la app). date_approved puede llegar días después.
  const ts = p.date_created || p.date_approved;
  const type = p.payment_type_id || null;
  return {
    id: `pay_${p.id}`,
    source: 'mp',
    ts: new Date(ts).toISOString(),
    day: localDay(ts),
    amount: direction === 'sale' ? -amount : amount,
    refunded,
    currency: p.currency_id || 'ARS',
    direction,
    op: p.operation_type || null,
    method: p.payment_method_id || null,
    mp_type: type,
    description: p.description || p.additional_info?.items?.[0]?.title || p.statement_descriptor || null,
    counterparty: iPaid
      ? fullName(p.collector) || p.collector?.email || p.statement_descriptor || null
      : fullName(p.payer) || p.payer?.email || null,
    channel: p.point_of_interaction?.type || null,
    status: p.status,
    // Lo pagado con tarjeta de crédito o débito de otro banco no sale del saldo de MP
    pocket: direction === 'interno' || direction === 'ajeno' ? null : direction === 'sale' && type && !FROM_MP_BALANCE.has(type) ? 'externo' : 'mp',
  };
}
