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
