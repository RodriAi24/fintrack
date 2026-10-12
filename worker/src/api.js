// API de la app (/api/*). Todo pasa antes por authorize() en index.js.

import { ensureSchema, upsertMovements, getMovement, listMovements, getKv, setKv, allKv, listRules } from './db.js';
import { runSync } from './sync.js';
import { classify, CATEGORIES, normalizeText } from './classify.js';
import { localDay } from './mp.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

const KV_KEYS = new Set(['pockets', 'budgets', 'goals', 'game', 'prefs']);
const KINDS = new Set(['gasto', 'ingreso', 'interno', 'reintegro', 'descartado']);
const CURRENCIES = new Set(['ARS', 'USD', 'USDC']);
const catIds = new Set([...CATEGORIES.gasto, ...CATEGORIES.ingreso].map(c => c.id));
const HISTORY_DAYS = 400;

const sinceDay = days => localDay(new Date(Date.now() - days * 86400_000).toISOString());
const rid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return bad('Falta la base de datos (binding DB).', 500);
  await ensureSchema(db);
  const method = request.method;

  // Los cambios solo desde la propia app (mismo origen)
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return bad('Origen no permitido.', 403);
  }

  if (path === '/api/state' && method === 'GET') {
    const [movements, kv, rules] = await Promise.all([listMovements(db, sinceDay(HISTORY_DAYS)), allKv(db), listRules(db)]);
    return json({ ok: true, now: new Date().toISOString(), movements, kv, rules, categories: CATEGORIES });
  }

  if (path === '/api/sync' && method === 'POST') {
    const state = await getKv(db, 'sync', {});
    if (state.last_run && Date.now() - Date.parse(state.last_run) < 60_000) {
      return json({ ok: true, skipped: true, message: 'Recién sincronicé, esperá un minuto.' });
    }
    return json(await runSync(env, db));
  }

  if (path === '/api/movements' && method === 'POST') return createManual(db, await body(request));

  const movMatch = path.match(/^\/api\/movements\/([\w-]+)$/);
  if (movMatch && method === 'PATCH') return editMovement(db, movMatch[1], await body(request));
  if (movMatch && method === 'DELETE') {
    const m = await getMovement(db, movMatch[1]);
    if (!m) return bad('No existe.', 404);
    if (m.source !== 'manual') return bad('Solo se pueden borrar los movimientos cargados a mano.');
    await db.prepare('DELETE FROM movements WHERE id = ?').bind(m.id).run();
    return json({ ok: true });
  }

  const kvMatch = path.match(/^\/api\/kv\/(\w+)$/);
  if (kvMatch && method === 'PUT') {
    if (!KV_KEYS.has(kvMatch[1])) return bad('Clave no permitida.');
    const raw = await request.text();
    if (raw.length > 200_000) return bad('Demasiado grande.');
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return bad('JSON inválido.');
    }
    await setKv(db, kvMatch[1], value);
    return json({ ok: true });
  }

  const ruleMatch = path.match(/^\/api\/rules\/([\w-]+)$/);
  if (ruleMatch && method === 'DELETE') {
    await db.prepare('DELETE FROM rules WHERE id = ?').bind(ruleMatch[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/export' && method === 'GET') {
    const [movements, kv, rules] = await Promise.all([listMovements(db, '0000-01-01'), allKv(db), listRules(db)]);
    return json({ app: 'fintrack', version: 1, exported_at: new Date().toISOString(), movements, kv, rules });
  }
  if (path === '/api/import' && method === 'POST') return importBackup(db, await body(request));

  return bad('No existe.', 404);
}

function validManual(b) {
  if (!b || typeof b !== 'object') return 'Datos inválidos.';
  if (!KINDS.has(b.kind) || b.kind === 'descartado' || b.kind === 'reintegro') return 'Tipo inválido.';
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return 'Monto inválido.';
  if (!CURRENCIES.has(b.currency)) return 'Moneda inválida.';
  if (b.category && !catIds.has(b.category)) return 'Categoría inválida.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || '')) return 'Fecha inválida.';
  return null;
}

async function createManual(db, b) {
  const err = validManual(b);
  if (err) return bad(err);
  const amount = Math.abs(Number(b.amount));
  const signed = b.kind === 'gasto' || (b.kind === 'interno' && b.direction === 'sale') ? -amount : amount;
  // Hora real si es hoy; mediodía si es otro día
  const today = localDay(new Date().toISOString());
  const ts = b.day === today ? new Date().toISOString() : new Date(`${b.day}T12:00:00-03:00`).toISOString();
  const m = {
    id: rid('man'), source: 'manual', ts, day: b.day, amount: signed, currency: b.currency,
    direction: signed < 0 ? 'sale' : 'entra', description: String(b.description || '').slice(0, 120) || null,
    counterparty: null, pocket: String(b.pocket || 'efectivo').slice(0, 40), status: 'approved',
    kind: b.kind, category: b.category || null, essential: b.kind === 'gasto' ? (b.essential === false ? 0 : 1) : null,
    review: 0, category_source: 'manual', user_edited: 1,
  };
  await upsertMovements(db, [m]);
  if (b.note) await db.prepare('UPDATE movements SET note = ? WHERE id = ?').bind(String(b.note).slice(0, 300), m.id).run();
  return json({ ok: true, movement: await getMovement(db, m.id) });
}

async function editMovement(db, id, b) {
  const m = await getMovement(db, id);
  if (!m) return bad('No existe.', 404);
  if (!b || typeof b !== 'object') return bad('Datos inválidos.');
  const set = {};
  if (b.kind !== undefined) {
    if (!KINDS.has(b.kind)) return bad('Tipo inválido.');
    set.kind = b.kind;
  }
  if (b.category !== undefined) {
    if (b.category !== null && !catIds.has(b.category)) return bad('Categoría inválida.');
    set.category = b.category;
  }
  if (b.essential !== undefined) set.essential = b.essential === null ? null : b.essential ? 1 : 0;
  if (b.note !== undefined) set.note = b.note ? String(b.note).slice(0, 300) : null;
  if (b.linked_id !== undefined) set.linked_id = b.linked_id || null;
  if (m.source === 'manual') {
    if (b.description !== undefined) set.description = String(b.description || '').slice(0, 120) || null;
    if (b.amount !== undefined) {
      const a = Math.abs(Number(b.amount));
      if (!Number.isFinite(a) || a <= 0) return bad('Monto inválido.');
      set.amount = m.amount < 0 ? -a : a;
    }
    if (b.day !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.day)) set.day = b.day;
    if (b.pocket !== undefined) set.pocket = String(b.pocket).slice(0, 40);
  }
  set.review = 0;
  set.user_edited = 1;
  set.category_source = 'manual';
  set.updated_at = new Date().toISOString();
  const cols = Object.keys(set);
  await db.prepare(`UPDATE movements SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(c => set[c]), id).run();

  // Aprender: crear la regla y aplicarla a los parecidos que nadie tocó
  let applied = 0;
  if (b.rule?.pattern && String(b.rule.pattern).trim().length >= 3) {
    const updated = await getMovement(db, id);
    const rule = {
      id: rid('rule'), pattern: String(b.rule.pattern).trim().slice(0, 60).toLowerCase(),
      category: updated.category, kind: updated.kind, essential: updated.essential, created_at: new Date().toISOString(),
    };
    await db.prepare('INSERT INTO rules (id, pattern, category, kind, essential, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(rule.id, rule.pattern, rule.category, rule.kind, rule.essential, rule.created_at).run();
    applied = await reapplyRules(db);
  }
  return json({ ok: true, movement: await getMovement(db, id), applied });
}

// Re-clasifica lo que nadie corrigió a mano (después de crear una regla)
async function reapplyRules(db) {
  const rules = await listRules(db);
  const me = await getKv(db, 'me', {});
  const { results } = await db.prepare('SELECT * FROM movements WHERE user_edited = 0 AND day >= ?').bind(sinceDay(HISTORY_DAYS)).all();
  const changed = [];
  for (const m of results) {
    const c = classify({ ...m, kind_hint: m.op === 'rendimiento' ? 'rendimiento' : m.op === 'refund' ? 'reintegro' : m.op === 'payout' ? 'payout' : null }, { rules, myName: me.name });
    if (c.category !== m.category || c.kind !== m.kind || c.review !== m.review) changed.push({ ...m, ...c });
  }
  await upsertMovements(db, changed);
  return changed.length;
}

// Backup: valida todo antes de tocar nada
function validBackup(b) {
  if (!b || b.app !== 'fintrack' || b.version !== 1) return 'No es un backup de FinTrack (versión 1).';
  if (!Array.isArray(b.movements) || !Array.isArray(b.rules) || typeof b.kv !== 'object' || !b.kv) return 'Al backup le faltan partes.';
  for (const m of b.movements) {
    if (typeof m.id !== 'string' || typeof m.amount !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(m.day || '') || !m.ts) return `Movimiento inválido: ${String(m?.id).slice(0, 40)}`;
  }
  for (const r of b.rules) if (typeof r.pattern !== 'string' || !r.id) return 'Regla inválida.';
  return null;
}

async function importBackup(db, b) {
  const err = validBackup(b);
  if (err) return bad(err);
  // Solo lo que es tuyo: movimientos a mano y correcciones. Lo de MP vuelve solo con la sincronización.
  const mine = b.movements.filter(m => m.source === 'manual' || m.user_edited);
  await upsertMovements(db, mine.map(m => ({ ...m, user_edited: 1 })));
  for (const m of mine) {
    if (m.note) await db.prepare('UPDATE movements SET note = ? WHERE id = ?').bind(String(m.note).slice(0, 300), m.id).run();
  }
  await db.prepare('DELETE FROM rules').run();
  for (const r of b.rules) {
    await db.prepare('INSERT INTO rules (id, pattern, category, kind, essential, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(r.id, normalizeText(r.pattern).trim(), r.category ?? null, r.kind ?? null, r.essential ?? null, r.created_at || new Date().toISOString()).run();
  }
  for (const [k, v] of Object.entries(b.kv)) if (KV_KEYS.has(k)) await setKv(db, k, v);
  return json({ ok: true, movements: mine.length, rules: b.rules.length });
}
