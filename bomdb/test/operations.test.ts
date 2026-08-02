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
  assert.equal(list.length, 1);
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

test('set_outcome records worked/failed with notes', async () => {
  const p = await runOp(engine, 'create_project', { name: 'outcome-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', { project_id: p.id, description: 'buck converter' }) as { id: string };
  const res = await runOp(engine, 'set_outcome', {
    line_item_id: li.id, outcome: 'worked', outcome_notes: 'browned out under pump inrush until cap added',
  }) as { outcome: string };
  assert.equal(res.outcome, 'worked');
});
