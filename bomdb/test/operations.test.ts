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
