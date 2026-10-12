// Cliente de Mercado Pago + normalización de movimientos.
// Nada acá crea pagos, reembolsos ni transferencias. Las únicas escrituras son pedir
// reportes (y su configuración), que no mueven plata.

const API = 'https://api.mercadopago.com';

async function mpRequest(env, method, path, { params, body, text = false } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const headers = { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
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

const OPERATION_TYPES = {
  regular_payment: 'pago',
  money_transfer: 'transferencia',
  recurring_payment: 'suscripción',
  account_fund: 'carga de saldo',
  payment_addition: 'pago adicional',
  cellphone_recharge: 'recarga de celular',
  pos_payment: 'pago en local',
  money_exchange: 'cambio de moneda',
  investment: 'inversión',
};

const round = n => Math.round(Number(n || 0) * 100) / 100;
const fullName = p => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || null;

// Estados que no movieron plata: no son movimientos
export const NOT_A_MOVEMENT = new Set(['cancelled', 'rejected', 'pending', 'in_process', 'authorized']);

// Día calendario en Argentina (MP devuelve fechas en -04:00)
export function localDay(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso));
}

// Pago de /v1/payments/search → movimiento.
// Ojo: cuando pagaste vos, MP manda `payer_id` (sin objeto payer) y el destinatario en `collector`;
// cuando cobraste, manda el objeto `payer` y `collector_id`.
export function normalizePayment(p, myId) {
  const payerId = p.payer?.id ?? p.payer_id;
  const collectorId = p.collector_id ?? p.collector?.id;
  const iPaid = String(payerId ?? '') === String(myId);
  const iCollected = String(collectorId ?? '') === String(myId);
  const amount = round(p.transaction_amount);
  const direction = iPaid && iCollected ? 'interno' : iPaid ? 'sale' : iCollected ? 'entra' : 'desconocido';
  // date_created = cuándo lo hiciste (lo que muestra la app de MP). date_approved puede llegar días
  // después (ej.: Uber con la Mastercard prepaga).
  const fecha = p.date_created || p.date_approved;
  return {
    id: `pay_${p.id}`,
    fecha,
    dia: localDay(fecha),
    monto: direction === 'sale' ? -amount : amount,
    moneda: p.currency_id,
    sentido: direction,
    tipo: OPERATION_TYPES[p.operation_type] || p.operation_type || 'pago',
    medio: p.payment_type_id || null,
    descripcion: p.description || p.additional_info?.items?.[0]?.title || p.statement_descriptor || null,
    contraparte: iPaid
      ? fullName(p.collector) || p.collector?.email || p.statement_descriptor || null
      : fullName(p.payer) || p.payer?.email || null,
    estado: p.status,
    fuente: 'payments',
  };
}

// Movimiento de /mercadopago_account/movements/search (no documentado: mapeo defensivo)
export function normalizeMovement(m) {
  const amount = round(m.amount ?? m.net_amount ?? m.transaction_amount);
  const fecha = m.date_created || m.date_released || m.date;
  return {
    id: `mov_${m.id}`,
    ref: m.reference_id ? `pay_${m.reference_id}` : null,
    fecha,
    dia: localDay(fecha),
    monto: amount,
    moneda: m.currency_id || null,
    sentido: amount < 0 ? 'sale' : 'entra',
    tipo: m.concept_type || m.type || null,
    medio: null,
    descripcion: m.detail || m.description || null,
    contraparte: null,
    estado: m.status || null,
    fuente: 'movements',
  };
}

// Order de /v1/orders → movimiento (son cobros hechos con tu integración)
export function normalizeOrder(o) {
  const fecha = o.created_date || o.last_updated_date;
  return {
    id: `ord_${o.id}`,
    fecha,
    dia: localDay(fecha),
    monto: round(o.total_amount ?? o.total_paid_amount),
    moneda: o.currency || null,
    sentido: 'entra',
    tipo: 'order',
    medio: o.transactions?.payments?.[0]?.payment_method?.type || null,
    descripcion: o.description || o.items?.[0]?.title || null,
    contraparte: o.payer?.email || null,
    estado: o.status,
    fuente: 'orders',
  };
}

// Nombres de campos (sin valores) para entender respuestas no documentadas
export function fieldNames(obj, prefix = '', depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 1) return [];
  return Object.entries(obj).flatMap(([k, v]) =>
    [prefix + k, ...fieldNames(v, `${prefix}${k}.`, depth + 1)]);
}
