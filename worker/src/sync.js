// Sincronización con Mercado Pago. La corre el cron cada 2 horas y la app cuando la abrís.
// 1. Búsqueda de pagos (pagos y cobros, con detalle).
// 2. Reporte de dinero en cuenta: se pide una vez por día y se baja en la corrida siguiente.

import { mpGet, normalizePayment } from './mp.js';
import { ensureConfig, listReports, requestReport, downloadReport, reportToMovements, reportDate } from './report.js';
import { classify } from './classify.js';
import { upsertMovements, existingIds, getKv, setKv, listRules } from './db.js';

const FIRST_DAYS = 364; // la búsqueda de MP acepta rangos de menos de 365 días
const OVERLAP_DAYS = 10; // re-leer los últimos días: los pagos cambian de estado
const REPORT_EVERY_MS = 20 * 3600_000;

async function getMe(env, db) {
  const cached = await getKv(db, 'me');
  if (cached?.id) return cached;
  const me = await mpGet(env, '/users/me');
  if (me.http !== 200) throw new Error(`El token de Mercado Pago no anda (${me.error})`);
  const out = { id: me.body.id, name: [me.body.first_name, me.body.last_name].filter(Boolean).join(' '), nickname: me.body.nickname };
  await setKv(db, 'me', out);
  return out;
}

async function context(db, me) {
  const rules = await listRules(db);
  const pockets = await getKv(db, 'pockets', []);
  const reserve = pockets.find(p => p.id === 'reserva');
  return { rules, myName: me.name, reserve: reserve ? { balance: reserve.anchor?.amount || 0, rate: reserve.rate || 0 } : null };
}

function classified(raw, ctx) {
  return { ...raw, ...classify(raw, ctx) };
}

async function fetchPayments(env, role, myId, days) {
  const all = [];
  for (let offset = 0; offset < 5000; offset += 50) {
    const r = await mpGet(env, '/v1/payments/search', {
      [`${role}.id`]: myId, sort: 'date_created', criteria: 'desc', range: 'date_created',
      begin_date: `NOW-${days}DAYS`, end_date: 'NOW', limit: 50, offset,
    });
    if (r.http !== 200) throw new Error(`búsqueda de pagos (${role}): ${r.error}`);
    const page = r.body?.results || [];
    all.push(...page);
    if (page.length < 50 || all.length >= (r.body?.paging?.total ?? 0)) break;
  }
  return all;
}

export async function syncPayments(env, db, state) {
  const me = await getMe(env, db);
  const ctx = await context(db, me);
  const days = state.payments_at ? OVERLAP_DAYS : FIRST_DAYS;
  const [paid, collected] = await Promise.all([fetchPayments(env, 'payer', me.id, days), fetchPayments(env, 'collector', me.id, days)]);
  const byId = new Map();
  for (const p of [...paid, ...collected]) byId.set(p.id, p);
  const movements = [...byId.values()].map(p => classified(normalizePayment(p, me.id), ctx));
  await upsertMovements(db, movements);
  return movements.length;
}

export async function syncReport(env, db, state) {
  const out = { downloaded: 0, requested: false };
  const cfg = await ensureConfig(env);
  if (!cfg.ok) throw new Error(cfg.error);

  // ¿Hay un reporte nuevo para bajar?
  const list = await listReports(env);
  if (!list.ok) throw new Error(list.error);
  const processed = new Set(state.report_files || []);
  const fresh = list.reports.find(r => !processed.has(r.file_name) && (!state.report_requested_at || reportDate(r) >= Date.parse(state.report_requested_at) - 60_000));
  if (fresh) {
    const file = await downloadReport(env, fresh.file_name);
    if (!file.ok) throw new Error(file.error);
    const me = await getMe(env, db);
    const ctx = await context(db, me);
    const raw = reportToMovements(file.rows, ctx);
    // Los pagos que ya trajo la búsqueda tienen más detalle: del reporte solo entra lo que falta
    const reportOnly = raw.filter(m => m.report_only).map(m => m.id);
    const have = await existingIds(db, reportOnly);
    const toSave = raw.filter(m => !(m.report_only && have.has(m.id))).map(m => classified(m, ctx));
    await upsertMovements(db, toSave);
    state.report_files = [...processed, fresh.file_name].slice(-30);
    out.downloaded = toSave.length;
  }

  // ¿Toca pedir uno nuevo?
  if (!state.report_requested_at || Date.now() - Date.parse(state.report_requested_at) > REPORT_EVERY_MS) {
    const asked = await requestReport(env, 30); // 30 días: es lo que MP acepta (con 120 falla)
    if (!asked.ok) throw new Error(asked.error);
    state.report_requested_at = new Date().toISOString();
    out.requested = true;
  }
  return out;
}

// Corre todo y deja el estado en kv('sync'). Nunca tira: los errores quedan anotados.
export async function runSync(env, db) {
  const state = await getKv(db, 'sync', {});
  const result = { ok: true, errors: [] };
  if (!env.MP_ACCESS_TOKEN) {
    result.ok = false;
    result.errors.push('Falta el secret MP_ACCESS_TOKEN en Cloudflare.');
  } else {
    try {
      result.payments = await syncPayments(env, db, state);
      state.payments_at = new Date().toISOString();
    } catch (e) {
      result.ok = false;
      result.errors.push(String(e.message || e));
    }
    try {
      result.report = await syncReport(env, db, state);
      if (result.report.downloaded) state.report_at = new Date().toISOString();
    } catch (e) {
      result.ok = false;
      result.errors.push(String(e.message || e));
    }
  }
  state.last_run = new Date().toISOString();
  state.last_errors = result.errors;
  await setKv(db, 'sync', state);
  return result;
}
