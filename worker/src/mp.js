// Cliente de solo lectura de Mercado Pago + normalización de movimientos.
// Nada acá crea pagos, reembolsos ni transferencias: solo GET.

const API = 'https://api.mercadopago.com';

export async function mpGet(env, path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  } catch (e) {
    return { http: 0, body: null, error: 'sin conexión con Mercado Pago' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  const error = res.ok ? null : [body?.error, body?.message].filter(Boolean).join(' · ').slice(0, 200) || `HTTP ${res.status}`;
  return { http: res.status, body, error };
}

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

// Pago de /v1/payments/search → movimiento
export function normalizePayment(p, myId) {
  const iPaid = String(p.payer?.id ?? '') === String(myId);
  const iCollected = String(p.collector_id ?? p.collector?.id ?? '') === String(myId);
  const amount = round(p.transaction_amount);
  const direction = iPaid && iCollected ? 'interno' : iPaid ? 'sale' : iCollected ? 'entra' : 'desconocido';
  return {
    id: `pay_${p.id}`,
    fecha: p.date_approved || p.date_created,
    monto: direction === 'sale' ? -amount : amount,
    moneda: p.currency_id,
    sentido: direction,
    tipo: OPERATION_TYPES[p.operation_type] || p.operation_type || 'pago',
    medio: p.payment_type_id || null,
    descripcion: p.description || p.additional_info?.items?.[0]?.title || p.statement_descriptor || null,
    contraparte: iPaid
      ? p.collector?.nickname || p.statement_descriptor || p.point_of_interaction?.business_info?.sub_unit || null
      : fullName(p.payer) || p.payer?.email || null,
    estado: p.status,
    fuente: 'payments',
  };
}

// Movimiento de /mercadopago_account/movements/search (no documentado: mapeo defensivo)
export function normalizeMovement(m) {
  const amount = round(m.amount ?? m.net_amount ?? m.transaction_amount);
  return {
    id: `mov_${m.id}`,
    ref: m.reference_id ? `pay_${m.reference_id}` : null,
    fecha: m.date_created || m.date_released || m.date,
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
  return {
    id: `ord_${o.id}`,
    fecha: o.created_date || o.last_updated_date,
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
