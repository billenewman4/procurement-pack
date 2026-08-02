import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp, NUMERIC_KEYS, DATE_ONLY_KEYS } from '../src/operations.ts';

let engine: Engine;
before(async () => { engine = await createTestEngine(); });
after(async () => { await engine.close(); });

test('create_project returns the row; list_projects sees it', async () => {
  const created = await runOp(engine, 'create_project', { name: 'plant-waterer-v1' }) as { id: string; name: string };
  assert.equal(created.name, 'plant-waterer-v1');
  assert.ok(created.id);
  const list = await runOp(engine, 'list_projects', {}) as { id: string }[];
  assert.ok(list.some(p => p.id === created.id));
});

test('upsert_spec inserts then replaces per (project, category)', async () => {
  const p = await runOp(engine, 'create_project', { name: 'spec-test' }) as { id: string };
  await runOp(engine, 'upsert_spec', { project_id: p.id, category: 'power', spec: '12V rail, 3A max' });
  await runOp(engine, 'upsert_spec', { project_id: p.id, category: 'power', spec: '12V rail, 5A max' });
  const ctx = await runOp(engine, 'get_project_context', { project_id: p.id }) as { specs: { category: string; spec: string }[] };
  const power = ctx.specs.filter(s => s.category === 'power');
  assert.equal(power.length, 1);
  assert.equal(power[0].spec, '12V rail, 5A max');
});

test('unknown op returns a clean error', async () => {
  const res = await runOp(engine, 'nonsense_op', {}) as { error: string };
  assert.match(res.error, /unknown operation/i);
});

test('missing required param returns a clean error, not a throw', async () => {
  const res = await runOp(engine, 'create_project', {}) as { error: string };
  assert.match(res.error, /name/);
});

test('upsert_line_item creates with defaults; update by id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'li-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'step-down converter 12V→5V 3A',
    vendor: 'Amazon', qty: 2, unit_price: 11.99, source: 'search',
    chosen_because: '12V rail, 400mA < 3A budget',
  }) as { id: string; status: string };
  assert.equal(li.status, 'needed');
  const updated = await runOp(engine, 'upsert_line_item', {
    id: li.id, project_id: p.id, description: 'step-down converter 12V→5V 3A', qty: 3,
  }) as { qty: number };
  assert.equal(updated.qty, 3);
});

test('update_status: forward auto, backward refused without confirm', async () => {
  const p = await runOp(engine, 'create_project', { name: 'status-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'pump', status: 'ordered',
  }) as { id: string };
  const fwd = await runOp(engine, 'update_status', { line_item_id: li.id, status: 'shipped' }) as { status: string };
  assert.equal(fwd.status, 'shipped');
  const back = await runOp(engine, 'update_status', { line_item_id: li.id, status: 'ordered' }) as { error: string };
  assert.match(back.error, /confirm/i);
  const confirmed = await runOp(engine, 'update_status', {
    line_item_id: li.id, status: 'ordered', confirmed: true,
  }) as { status: string };
  assert.equal(confirmed.status, 'ordered');
});

test('upsert_line_item update path refuses status changes and wrong project_id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'li-guard-test' }) as { id: string };
  const other = await runOp(engine, 'create_project', { name: 'li-guard-other' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'relay module',
  }) as { id: string };
  // status on the update path must be refused, not silently dropped
  const refused = await runOp(engine, 'upsert_line_item', {
    id: li.id, project_id: p.id, description: 'relay module', status: 'ordered',
  }) as { error: string };
  assert.match(refused.error, /update_status/);
  // mismatched project_id must not touch another project's item
  const wrongProject = await runOp(engine, 'upsert_line_item', {
    id: li.id, project_id: other.id, description: 'hijacked',
  }) as { error: string };
  assert.match(wrongProject.error, /not found/);
  const ctx = await runOp(engine, 'get_project_context', { project_id: p.id }) as { line_items: { id: string; description: string; status: string }[] };
  const row = ctx.line_items.find(r => r.id === li.id)!;
  assert.equal(row.description, 'relay module');
  assert.equal(row.status, 'needed');
});

test('malformed uuid returns a clean error, not a throw', async () => {
  const res = await runOp(engine, 'get_project_context', { project_id: 'not-a-uuid' }) as { error: string };
  assert.ok(res.error);
});

test('set_outcome records worked/failed with notes', async () => {
  const p = await runOp(engine, 'create_project', { name: 'outcome-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', { project_id: p.id, description: 'buck converter' }) as { id: string };
  const res = await runOp(engine, 'set_outcome', {
    line_item_id: li.id, outcome: 'worked', outcome_notes: 'browned out under pump inrush until cap added',
  }) as { outcome: string };
  assert.equal(res.outcome, 'worked');
});

test('record_order_event auto-advances matched item forward only', async () => {
  const p = await runOp(engine, 'create_project', { name: 'event-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'pump', status: 'ordered',
  }) as { id: string };
  const ev = await runOp(engine, 'record_order_event', {
    project_id: p.id, line_item_id: li.id, vendor: 'Amazon', order_number: '112-4477',
    event: 'shipped', event_at: '2026-08-02T14:00:00Z',
    raw_summary: 'Amazon order 112-4477 shipped, ETA Aug 6',
  }) as { event: string; line_item_status: string };
  assert.equal(ev.line_item_status, 'shipped');
  // a backordered event must NOT move the item backward — only flag
  const back = await runOp(engine, 'record_order_event', {
    project_id: p.id, line_item_id: li.id, vendor: 'Amazon', order_number: '112-4477',
    event: 'backordered', event_at: '2026-08-03T14:00:00Z', raw_summary: 'backordered',
  }) as { line_item_status: string; flag?: string };
  assert.equal(back.line_item_status, 'shipped'); // unchanged
  assert.ok(back.flag, 'anomaly should be flagged for the user');
});

test('unmatched events are kept with null line_item_id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'unmatched-test' }) as { id: string };
  const ev = await runOp(engine, 'record_order_event', {
    project_id: p.id, vendor: 'McMaster-Carr', order_number: '9999',
    event: 'confirmed', event_at: '2026-08-02T15:00:00Z', raw_summary: 'order 9999 confirmed',
  }) as { line_item_id: string | null };
  assert.equal(ev.line_item_id, null);
});

test('stale_orders finds ordered items with no recent event', async () => {
  const p = await runOp(engine, 'create_project', { name: 'stale-test' }) as { id: string };
  await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'old order', status: 'ordered',
    ordered_at: '2026-07-01T00:00:00Z',
  });
  const stale = await runOp(engine, 'stale_orders', { days: 7 }) as { description: string }[];
  assert.equal(stale.length, 1);
  assert.equal(stale[0].description, 'old order');
});

test('op results are clean JSON: Dates→ISO strings, unit_price→number, eta→date-only', async () => {
  const p = await runOp(engine, 'create_project', { name: 'json-clean-test' }) as { id: string };
  await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'buck converter', unit_price: 11.99, eta: '2026-08-02',
  });
  const ctx = await runOp(engine, 'get_project_context', { project_id: p.id }) as {
    project: { created_at: unknown };
    line_items: { unit_price: unknown; eta: unknown; created_at: unknown }[];
  };
  assert.equal(typeof ctx.project.created_at, 'string');
  assert.match(ctx.project.created_at as string, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.equal(ctx.line_items[0].unit_price, 11.99); // number, not "11.99"
  assert.equal(ctx.line_items[0].eta, '2026-08-02'); // date column → date-only string
});

test('schema drift tripwire: every numeric/date column is in the coercion key sets', () => {
  // If someone adds a numeric or date (not timestamptz) column to schema.sql
  // without teaching toJsonResult about it, MCP output regresses to driver
  // strings / midnight-UTC timestamps. This test catches that at add time.
  const schema = readFileSync(
    fileURLToPath(new URL('../src/schema.sql', import.meta.url)), 'utf8');
  const numericCols: string[] = [];
  const dateCols: string[] = [];
  for (const line of schema.split('\n')) {
    const m = line.match(/^\s*(\w+)\s+(numeric|date)\b/i);
    if (!m) continue; // timestamptz doesn't match \bdate\b
    (m[2].toLowerCase() === 'numeric' ? numericCols : dateCols).push(m[1]);
  }
  // sanity: the parser actually found the known columns
  assert.ok(numericCols.includes('unit_price'), 'schema parser should find unit_price');
  assert.ok(dateCols.includes('eta'), 'schema parser should find eta');
  for (const col of numericCols) {
    assert.ok(NUMERIC_KEYS.has(col), `numeric column "${col}" missing from NUMERIC_KEYS`);
  }
  for (const col of dateCols) {
    assert.ok(DATE_ONLY_KEYS.has(col), `date column "${col}" missing from DATE_ONLY_KEYS`);
  }
});

test('record_order_event cannot advance a line item in another project', async () => {
  const pA = await runOp(engine, 'create_project', { name: 'xproj-a' }) as { id: string };
  const pB = await runOp(engine, 'create_project', { name: 'xproj-b' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: pA.id, description: 'solenoid valve', status: 'ordered',
  }) as { id: string };
  const ev = await runOp(engine, 'record_order_event', {
    project_id: pB.id, line_item_id: li.id, vendor: 'Amazon',
    event: 'shipped', event_at: '2026-08-02T14:00:00Z', raw_summary: 'shipped',
  }) as { line_item_id: string | null; line_item_status: string | null; flag?: string };
  // event kept, but unlinked — and flagged for manual reconciliation
  assert.equal(ev.line_item_id, null);
  assert.ok(ev.flag, 'cross-project mismatch should be flagged');
  // the other project's item is untouched
  const ctx = await runOp(engine, 'get_project_context', { project_id: pA.id }) as { line_items: { id: string; status: string }[] };
  assert.equal(ctx.line_items.find(r => r.id === li.id)!.status, 'ordered');
});
