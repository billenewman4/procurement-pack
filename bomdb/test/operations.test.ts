import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

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
