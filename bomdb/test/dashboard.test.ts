import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

let engine: Engine;
let projectId: string;

interface DashboardProject {
  id: string;
  name: string;
  spec_categories: string[];
  status_counts: Record<string, number>;
  total_committed: number;
  open_issues: number;
  stale_items: { description: string }[];
  recent_events: { event: string; vendor: string }[];
}

before(async () => {
  engine = await createTestEngine();
  const p = await runOp(engine, 'create_project', { name: 'dash-test' }) as { id: string };
  projectId = p.id;
  await runOp(engine, 'upsert_spec', { project_id: projectId, category: 'power', spec: '5V USB' });
  const sensor = await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'sensor', qty: 2, unit_price: 10.5, status: 'ordered',
  }) as { id: string };
  await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'enclosure', qty: 1, unit_price: 20, status: 'needed',
  });
  await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'bad cable', qty: 1, unit_price: 3, status: 'issue',
  });
  const ev = await runOp(engine, 'record_order_event', {
    project_id: projectId, line_item_id: sensor.id, vendor: 'Digi-Key', event: 'confirmed',
    event_at: new Date().toISOString(), raw_summary: 'order confirmed (test seed)',
  }) as { error?: string };
  assert.equal(ev.error, undefined, `seed event failed: ${ev.error}`);
});

after(async () => { await engine.close(); });

test('get_dashboard_data aggregates one project correctly', async () => {
  const res = await runOp(engine, 'get_dashboard_data', {}) as { projects: DashboardProject[] };
  const proj = res.projects.find(p => p.id === projectId);
  assert.ok(proj, 'project missing from dashboard');
  assert.equal(proj.name, 'dash-test');
  assert.deepEqual(proj.spec_categories, ['power']);
  assert.equal(proj.status_counts.ordered, 1);
  assert.equal(proj.status_counts.needed, 1);
  assert.equal(proj.status_counts.issue, 1);
  // committed = ordered+ items only: 2 × 10.50 (the needed/issue items don't count)
  assert.equal(proj.total_committed, 21);
  assert.equal(proj.open_issues, 1);
  assert.equal(proj.recent_events.length, 1);
  assert.equal(proj.recent_events[0].vendor, 'Digi-Key');
  // the ordered sensor has an order event from just now — not stale
  assert.equal(proj.stale_items.length, 0);
});

test('get_dashboard_data scoped to one project_id', async () => {
  const other = await runOp(engine, 'create_project', { name: 'other-project' }) as { id: string };
  const res = await runOp(engine, 'get_dashboard_data', { project_id: projectId }) as { projects: DashboardProject[] };
  assert.ok(res.projects.every(p => p.id !== other.id));
  assert.ok(res.projects.some(p => p.id === projectId));
});
