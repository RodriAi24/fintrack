// Base de datos (D1). El esquema se crea solo la primera vez (CREATE IF NOT EXISTS).
// Regla de oro: lo que Rodrigo corrigió a mano (user_edited = 1) nunca lo pisa una sincronización.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, ts TEXT NOT NULL, day TEXT NOT NULL,
    amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'ARS', direction TEXT, op TEXT, method TEXT,
    mp_type TEXT, description TEXT, counterparty TEXT, channel TEXT, status TEXT, pocket TEXT,
    refunded REAL DEFAULT 0,
    kind TEXT, category TEXT, essential INTEGER, review INTEGER DEFAULT 0, category_source TEXT,
    note TEXT, linked_id TEXT, user_edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS movements_day ON movements(day)',
  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY, pattern TEXT NOT NULL, category TEXT, kind TEXT, essential INTEGER,
    created_at TEXT NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
];

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  schemaReady = true;
}

const SOURCE_FIELDS = ['source', 'ts', 'day', 'amount', 'currency', 'direction', 'op', 'method', 'mp_type',
  'description', 'counterparty', 'channel', 'status', 'pocket', 'refunded'];
const CLASS_FIELDS = ['kind', 'category', 'essential', 'review', 'category_source', 'linked_id'];
const ALL = ['id', ...SOURCE_FIELDS, ...CLASS_FIELDS, 'user_edited', 'created_at', 'updated_at'];

const UPSERT = `INSERT INTO movements (${ALL.join(', ')}) VALUES (${ALL.map(() => '?').join(', ')})
  ON CONFLICT(id) DO UPDATE SET
  ${SOURCE_FIELDS.map(f => `${f} = excluded.${f}`).join(', ')},
  ${CLASS_FIELDS.map(f => `${f} = CASE WHEN movements.user_edited = 1 THEN movements.${f} ELSE excluded.${f} END`).join(', ')},
  updated_at = excluded.updated_at`;

const val = v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

export async function upsertMovements(db, list) {
  if (!list.length) return 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(UPSERT);
  for (let i = 0; i < list.length; i += 50) {
    await db.batch(list.slice(i, i + 50).map(m =>
      stmt.bind(...ALL.map(f => (f === 'created_at' || f === 'updated_at' ? now : f === 'user_edited' ? m.user_edited ? 1 : 0 : val(m[f]))))));
  }
  return list.length;
}

export async function existingIds(db, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id FROM movements WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    results.forEach(r => found.add(r.id));
  }
  return found;
}

export async function getMovement(db, id) {
  return db.prepare('SELECT * FROM movements WHERE id = ?').bind(id).first();
}

export async function listMovements(db, sinceDay) {
  const { results } = await db.prepare('SELECT * FROM movements WHERE day >= ? ORDER BY ts DESC').bind(sinceDay).all();
  return results;
}

export async function getKv(db, key, fallback = null) {
  const row = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export async function setKv(db, key, value) {
  await db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

export async function allKv(db) {
  const { results } = await db.prepare('SELECT key, value FROM kv').all();
  const out = {};
  for (const r of results) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* valor roto: se ignora */
    }
  }
  return out;
}

export async function listRules(db) {
  const { results } = await db.prepare('SELECT * FROM rules ORDER BY created_at DESC').all();
  return results;
}
