// Reporte de "dinero en cuenta" (settlement_report) de Mercado Pago.
// Trae lo que la búsqueda de pagos no ve: transferencias a CBU/CVU de otros bancos (PAYOUTS),
// rendimientos del disponible y de la reserva, y devoluciones. Es asincrónico: se pide y se
// descarga más tarde. Verificado al centavo contra la app de MP (12/10/2026).

import { mpGet, mpGetText, mpPost, localDay } from './mp.js';

const BASE = '/v1/account/settlement_report';

const COLUMNS = ['TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT',
  'TRANSACTION_CURRENCY', 'SETTLEMENT_NET_AMOUNT', 'SETTLEMENT_CURRENCY', 'PAYMENT_METHOD', 'PAYMENT_METHOD_TYPE',
  'DESCRIPTION', 'PAYER_NAME', 'POI_WALLET_NAME', 'POI_BANK_NAME', 'BUSINESS_UNIT', 'SUB_UNIT', 'OPERATION_TAGS', 'METADATA'];

const CONFIG = {
  file_name_prefix: 'fintrack', show_fee_prevision: false, show_chargeback_cancel: true, coupon_detailed: true,
  include_withdraw: true, shipping_detail: false, refund_detailed: true, display_timezone: 'GMT-03',
  header_language: 'en', frequency: { hour: 3, type: 'monthly', value: 1 }, // no se programa: solo queda definido
  columns: COLUMNS.map(key => ({ key })),
};

const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const reportDate = r => Date.parse(r.date_created || r.generation_date || r.last_modified || 0) || 0;

export async function ensureConfig(env) {
  const cfg = await mpGet(env, `${BASE}/config`);
  if (cfg.http === 200) return { ok: true };
  if (cfg.http !== 404) return { ok: false, error: `config: ${cfg.error}` };
  const made = await mpPost(env, `${BASE}/config`, CONFIG);
  return made.http === 200 || made.http === 201 ? { ok: true, created: true } : { ok: false, error: `crear config: ${made.error}` };
}

export async function listReports(env) {
  const list = await mpGet(env, `${BASE}/list`);
  if (list.http !== 200) return { ok: false, error: `listar: ${list.error}` };
  const reports = (Array.isArray(list.body) ? list.body : list.body?.results || [])
    .filter(r => String(r.file_name || '').endsWith('.csv'))
    .sort((a, b) => reportDate(b) - reportDate(a));
  return { ok: true, reports };
}

// days de largo, terminando hace endDaysAgo días
export async function requestReport(env, days, endDaysAgo = 0) {
  const end = new Date(Date.now() - endDaysAgo * 86400_000);
  const r = await mpPost(env, BASE, { begin_date: iso(new Date(end - days * 86400_000)), end_date: iso(end) });
  return r.http >= 200 && r.http < 300 ? { ok: true } : { ok: false, error: `No pude pedir el reporte diario de Mercado Pago (${r.error})` };
}

export async function downloadReport(env, fileName) {
  const file = await mpGetText(env, `${BASE}/${encodeURIComponent(fileName)}`);
  return file.http === 200 ? { ok: true, rows: parseCsv(file.body) } : { ok: false, error: `descargar: ${file.error}` };
}

const num = v => Number(String(v ?? '0').replace(',', '.')) || 0;
const cents = n => Math.round(Math.abs(n) * 100);

const isYield = r => r.TRANSACTION_TYPE === 'SETTLEMENT' && num(r.SETTLEMENT_NET_AMOUNT) > 0
  && !r.PAYMENT_METHOD && !r.PAYMENT_METHOD_TYPE && !r.PAYER_NAME && !r.EXTERNAL_REFERENCE;

// Filas del reporte → movimientos crudos. ctx: { reserve: { balance, rate } }
// Las filas SETTLEMENT comunes usan el mismo ID que la búsqueda de pagos (pay_<id>): el que
// llama decide si las inserta (solo las que la búsqueda no trajo).
export function reportToMovements(rows, ctx = {}) {
  const out = [];
  const base = r => {
    const ts = r.TRANSACTION_DATE;
    return { ts: new Date(ts).toISOString(), day: localDay(ts), currency: r.SETTLEMENT_CURRENCY || r.TRANSACTION_CURRENCY || 'ARS', source: 'mp_reporte', status: 'approved' };
  };

  // Rendimientos: dos filas por día con el mismo SOURCE_ID (disponible + reserva)
  const yields = {};
  for (const r of rows.filter(isYield)) (yields[r.SOURCE_ID] ||= []).push(r);
  let prevDay = null;
  for (const src of Object.keys(yields).sort((a, b) => Date.parse(yields[a][0].TRANSACTION_DATE) - Date.parse(yields[b][0].TRANSACTION_DATE))) {
    const group = yields[src];
    const day = localDay(group[0].TRANSACTION_DATE);
    const gap = prevDay ? Math.max(1, Math.round((Date.parse(day) - Date.parse(prevDay)) / 86400_000)) : 1;
    prevDay = day;
    let reserveIdx = -1;
    if (group.length >= 2) {
      const { balance = 0, rate = 0 } = ctx.reserve || {};
      const expected = balance > 0 && rate > 0 ? balance * rate / 100 / 365 * gap : null;
      const amounts = group.map(r => num(r.SETTLEMENT_NET_AMOUNT));
      reserveIdx = expected != null
        ? amounts.reduce((best, a, i) => (Math.abs(a - expected) < Math.abs(amounts[best] - expected) ? i : best), 0)
        : amounts.indexOf(Math.min(...amounts)); // sin datos de la reserva: la menor
    }
    group.forEach((r, i) => {
      const amount = num(r.SETTLEMENT_NET_AMOUNT);
      const reserve = i === reserveIdx;
      out.push({ ...base(r), id: `yld_${src}_${cents(amount)}`, amount, op: 'rendimiento', kind_hint: 'rendimiento',
        description: reserve ? 'Rendimientos · Reserva' : 'Rendimientos', pocket: reserve ? 'reserva' : 'mp' });
    });
  }

  for (const r of rows) {
    if (isYield(r)) continue;
    const amount = num(r.SETTLEMENT_NET_AMOUNT || r.TRANSACTION_AMOUNT);
    const src = r.SOURCE_ID;
    if (r.TRANSACTION_TYPE === 'PAYOUTS') {
      out.push({ ...base(r), id: `out_${src}`, amount, op: 'payout', kind_hint: 'payout', pocket: 'mp',
        description: 'Transferencia a otra cuenta', counterparty: r.POI_BANK_NAME || null });
    } else if (r.TRANSACTION_TYPE === 'REFUND') {
      out.push({ ...base(r), id: `ref_${src}_${cents(amount)}`, amount, op: 'refund', kind_hint: 'reintegro', pocket: 'mp',
        description: 'Devolución', linked_id: `pay_${src}` });
    } else if (r.TRANSACTION_TYPE === 'SETTLEMENT') {
      out.push({ ...base(r), id: `pay_${src}`, amount, pocket: 'mp', report_only: true,
        method: r.PAYMENT_METHOD || null, mp_type: r.PAYMENT_METHOD_TYPE || null,
        op: r.PAYMENT_METHOD_TYPE === 'bank_transfer' ? 'money_transfer' : null,
        direction: amount < 0 ? 'sale' : 'entra',
        description: r.DESCRIPTION || null,
        // En las salidas PAYER_NAME es el propio Rodrigo: no sirve como contraparte
        counterparty: amount > 0 ? r.PAYER_NAME || r.POI_WALLET_NAME || r.POI_BANK_NAME || null : null,
        channel: r.SUB_UNIT || null });
    } else {
      out.push({ ...base(r), id: `rep_${String(r.TRANSACTION_TYPE).toLowerCase()}_${src}_${cents(amount)}`, amount, pocket: 'mp',
        op: String(r.TRANSACTION_TYPE).toLowerCase(), description: r.TRANSACTION_TYPE });
    }
  }
  return out;
}

// CSV con comillas (RFC 4180). Detecta separador , o ;
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const out = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) out.push(row);
  const [header, ...data] = out;
  if (!header) return [];
  return data.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
