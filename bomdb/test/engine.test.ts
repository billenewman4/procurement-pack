import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine } from '../src/engine.ts';

test('initSchema creates all five tables', async () => {
  const engine = await createTestEngine();
  const rows = await engine.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const names = rows.map(r => r.table_name);
  for (const t of ['line_items', 'order_events', 'project_specs', 'projects', 'users']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  await engine.close();
});

test('initSchema is idempotent', async () => {
  const engine = await createTestEngine();
  await engine.initSchema(); // second run must not throw
  await engine.close();
});

test('undefined params are normalized to null (postgres.js parity contract)', async () => {
  const engine = await createTestEngine();
  // Omitted optional op params reach the engine as undefined; postgres.js
  // rejects undefined outright, so the Engine contract is: undefined ≡ null.
  const rows = await engine.query<{ id: string; part_number: string | null }>(
    `INSERT INTO projects (name) VALUES ($1) RETURNING id`, ['parity-test'],
  );
  const inserted = await engine.query<{ part_number: string | null }>(
    `INSERT INTO line_items (project_id, description, part_number) VALUES ($1, $2, $3) RETURNING part_number`,
    [rows[0].id, 'widget', undefined],
  );
  assert.equal(inserted[0].part_number, null);
  await engine.close();
});
