// Reporte de "dinero en cuenta" (settlement_report) de Mercado Pago.
// Sirve para ver lo que la búsqueda de pagos no trae: transferencias a CBU/CVU de otros bancos,
// retiros, y (si MP los incluye) rendimientos. Es asincrónico: se pide y se descarga minutos después.
// No mueve plata: solo crea la configuración del reporte (si no existe) y pide el archivo.

import { mpGet, mpGetText, mpPost, localDay } from './mp.js';

const BASE = '/v1/account/settlement_report';
const DAYS = 30;
const FRESH_MS = 6 * 3600_000; // un reporte de las últimas 6 h se reutiliza

const COLUMNS = ['TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT',
  'TRANSACTION_CURRENCY', 'SETTLEMENT_NET_AMOUNT', 'SETTLEMENT_CURRENCY', 'PAYMENT_METHOD', 'PAYMENT_METHOD_TYPE',
  'DESCRIPTION', 'PAYER_NAME', 'POI_WALLET_NAME', 'POI_BANK_NAME', 'BUSINESS_UNIT', 'SUB_UNIT', 'OPERATION_TAGS', 'METADATA'];

const CONFIG = {
  file_name_prefix: 'fintrack',
  show_fee_prevision: false,
  show_chargeback_cancel: true,
  coupon_detailed: true,
  include_withdraw: true,
  shipping_detail: false,
  refund_detailed: true,
  display_timezone: 'GMT-03',
  header_language: 'en',
  frequency: { hour: 3, type: 'monthly', value: 1 }, // no se programa: solo queda definido
  columns: COLUMNS.map(key => ({ key })),
};

const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const reportDate = r => Date.parse(r.date_created || r.generation_date || r.last_modified || 0) || 0;

export async function settlementReport(env) {
  // 1. Configuración: si no existe, crear una mínima (sin generación automática)
  let configCreated = false;
  const cfg = await mpGet(env, `${BASE}/config`);
  if (cfg.http === 404) {
    const made = await mpPost(env, `${BASE}/config`, CONFIG);
    if (made.http !== 200 && made.http !== 201) {
      return { ok: false, paso: 'crear configuración', http: made.http, error: made.error };
    }
    configCreated = true;
  } else if (cfg.http !== 200) {
    return { ok: false, paso: 'leer configuración', http: cfg.http, error: cfg.error };
  }

  // 2. ¿Hay un reporte reciente listo?
  const list = await mpGet(env, `${BASE}/list`);
  if (list.http !== 200) return { ok: false, paso: 'listar reportes', http: list.http, error: list.error };
  const reports = (Array.isArray(list.body) ? list.body : list.body?.results || [])
    .filter(r => String(r.file_name || '').endsWith('.csv'))
    .sort((a, b) => reportDate(b) - reportDate(a));
  const recent = reports.find(r => Date.now() - reportDate(r) < FRESH_MS);

  // 3. Si no hay, pedirlo
  if (!recent) {
    const now = new Date();
    const asked = await mpPost(env, BASE, { begin_date: iso(new Date(now - DAYS * 86400_000)), end_date: iso(now) });
    if (asked.http !== 200 && asked.http !== 201 && asked.http !== 202) {
      return { ok: false, paso: 'pedir reporte', http: asked.http, error: asked.error };
    }
    return {
      ok: true,
      estado: 'generando',
      mensaje: `Le pedí a Mercado Pago el reporte de los últimos ${DAYS} días. Volvé a abrir /reporte en 2 o 3 minutos.`,
      configuracion_creada: configCreated,
      reportes_anteriores: reports.length,
    };
  }

  // 4. Descargar y resumir
  const file = await mpGetText(env, `${BASE}/${encodeURIComponent(recent.file_name)}`);
  if (file.http !== 200) return { ok: false, paso: 'descargar reporte', http: file.http, error: file.error };
  const rows = parseCsv(file.body);
  const count = col => rows.reduce((acc, r) => ((acc[r[col] || '(vacío)'] = (acc[r[col] || '(vacío)'] || 0) + 1), acc), {});
  const movimientos = rows
    .map(r => {
      const neto = Number(String(r.SETTLEMENT_NET_AMOUNT || r.TRANSACTION_AMOUNT || '0').replace(',', '.'));
      return {
        id: r.SOURCE_ID ? `pay_${r.SOURCE_ID}` : null,
        fecha: r.TRANSACTION_DATE,
        dia: r.TRANSACTION_DATE ? localDay(r.TRANSACTION_DATE) : null,
        tipo: r.TRANSACTION_TYPE,
        monto: neto,
        moneda: r.SETTLEMENT_CURRENCY || r.TRANSACTION_CURRENCY,
        medio: r.PAYMENT_METHOD_TYPE || r.PAYMENT_METHOD || null,
        descripcion: r.DESCRIPTION || null,
        contraparte: r.PAYER_NAME || r.POI_WALLET_NAME || r.POI_BANK_NAME || null,
        canal: [r.BUSINESS_UNIT, r.SUB_UNIT].filter(Boolean).join(' / ') || null,
      };
    })
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));

  return {
    ok: true,
    estado: 'listo',
    archivo: { desde: recent.begin_date, hasta: recent.end_date, generado: recent.date_created || null },
    filas: rows.length,
    columnas: rows[0] ? Object.keys(rows[0]) : [],
    por_tipo: count('TRANSACTION_TYPE'),
    por_medio: count('PAYMENT_METHOD_TYPE'),
    movimientos,
  };
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
