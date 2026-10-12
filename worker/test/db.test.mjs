// La base con SQLite real (node:sqlite) haciendo de D1. Correr con: node --test worker/test/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureSchema, upsertMovements, confirmFromReport, getMovement } from '../src/db.js';

// Adaptador mínimo con la forma de D1
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    run: async () => sql.prepare(q).run(...args),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
  });
  return { prepare: q => wrap(q), batch: async stmts => { for (const s of stmts) await s.run(); } };
}

const base = { source: 'mp', ts: '2026-10-08T14:00:00.000Z', day: '2026-10-08', currency: 'ARS', status: 'approved', kind: 'gasto', category: 'otros', review: 0, category_source: 'auto' };

test('lo que confirmó el reporte de MP no lo pisa la búsqueda de pagos', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  // La búsqueda trae el pago (monto bruto, sin cuenta segura)
  await upsertMovements(db, [{ ...base, id: 'pay_1', amount: -15000, pocket: null }]);
  // El reporte lo confirma con el monto real que movió la cuenta
  await confirmFromReport(db, [{ id: 'pay_1', amount: -15380 }]);
  // Una sincronización posterior de la búsqueda vuelve a traerlo
  await upsertMovements(db, [{ ...base, id: 'pay_1', amount: -15000, pocket: null, description: 'El Nochi Market' }]);
  const m = await getMovement(db, 'pay_1');
  assert.equal(m.amount, -15380);
  assert.equal(m.pocket, 'mp');
  assert.equal(m.in_report, 1);
  assert.equal(m.description, 'El Nochi Market'); // los nombres sí se actualizan
});

test('lo corregido a mano tampoco se pisa', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  await upsertMovements(db, [{ ...base, id: 'pay_2', amount: -100, pocket: 'mp', category: 'salidas', user_edited: 1, category_source: 'manual' }]);
  await upsertMovements(db, [{ ...base, id: 'pay_2', amount: -100, pocket: 'mp', category: 'otros' }]);
  assert.equal((await getMovement(db, 'pay_2')).category, 'salidas');
});
