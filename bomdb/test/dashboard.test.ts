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
  buckets: { researching: number; ordered: number; delivered: number };
  total_committed: number;
  open_issues: number;
  stale_items: { description: string }[];
  recent_events: { event: string; vendor: string }[];
  items: { id: string; description: string; shipped: boolean; open_issue: boolean }[];
}

interface Dashboard {
  projects: DashboardProject[];
  one_offs: { description: string; status: string }[];
  vendors: { name: string; part_count: number }[];
}

before(async () => {
  engine = await createTestEngine();
  const p = await runOp(engine, 'create_project', { name: 'dash-test' }) as { id: string };
  projectId = p.id;
  await runOp(engine, 'upsert_spec', { project_id: projectId, category: 'power', spec: '5V USB' });
  const sensor = await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'sensor', qty: 2, unit_price: 10.5, status: 'po_placed',
  }) as { id: string };
  await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'enclosure', qty: 1, unit_price: 20, status: 'researching',
  });
  await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'gasket', qty: 1, unit_price: 2, status: 'rfq',
  });
  const cable = await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'bad cable', qty: 1, unit_price: 3, status: 'po_placed',
  }) as { id: string };
  const replaced = await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'replaced regulator', qty: 1, unit_price: 99, status: 'po_placed',
  }) as { id: string };
  await runOp(engine, 'set_item_active', { line_item_id: replaced.id, active: false });
  const ev = await runOp(engine, 'record_order_event', {
    project_id: projectId, line_item_id: sensor.id, vendor: 'Digi-Key', event: 'shipped',
    event_at: new Date().toISOString(), raw_summary: 'order shipped (test seed)',
  }) as { error?: string };
  assert.equal(ev.error, undefined, `seed event failed: ${ev.error}`);
  const issueEv = await runOp(engine, 'record_order_event', {
    project_id: projectId, line_item_id: cable.id, vendor: 'Amazon', event: 'issue',
    event_at: new Date().toISOString(), raw_summary: 'damaged in transit (test seed)',
  }) as { error?: string };
  assert.equal(issueEv.error, undefined, `seed issue event failed: ${issueEv.error}`);
  // a one-off master-list part, no project
  await runOp(engine, 'upsert_line_item', {
    description: 'M3 hex standoffs (historical)', vendor: 'McMaster-Carr', status: 'delivered',
  });
});

after(async () => { await engine.close(); });

test('get_dashboard_data aggregates one project correctly', async () => {
  const res = await runOp(engine, 'get_dashboard_data', {}) as Dashboard;
  const proj = res.projects.find(p => p.id === projectId);
  assert.ok(proj, 'project missing from dashboard');
  assert.equal(proj.name, 'dash-test');
  assert.deepEqual(proj.spec_categories, ['power']);
  assert.equal(proj.status_counts.po_placed, 2);
  assert.equal(proj.status_counts.researching, 1);
  assert.equal(proj.status_counts.rfq, 1);
  // buckets: Researching = researching+rfq, Ordered = po_placed, Delivered
  assert.deepEqual(proj.buckets, { researching: 2, ordered: 2, delivered: 0 });
  // committed = po_placed+delivered ACTIVE items: 2 × 10.50 + 1 × 3 (the
  // inactive 99-dollar regulator must not count)
  assert.equal(proj.total_committed, 24);
  // open issue derived from the unresolved issue event on the cable
  assert.equal(proj.open_issues, 1);
  assert.equal(proj.recent_events.length, 2);
  // the po_placed sensor has an order event from just now — not stale
  assert.equal(proj.stale_items.length, 0);
  // inactive items are excluded from the main view
  assert.ok(!proj.items.some(i => i.description === 'replaced regulator'));
  // shipped badge derives from the shipped event
  assert.equal(proj.items.find(i => i.description === 'sensor')!.shipped, true);
  assert.equal(proj.items.find(i => i.description === 'sensor')!.open_issue, false);
  assert.equal(proj.items.find(i => i.description === 'bad cable')!.open_issue, true);
});

test('get_dashboard_data carries one-offs and the vendor rollup', async () => {
  const res = await runOp(engine, 'get_dashboard_data', {}) as Dashboard;
  assert.equal(res.one_offs.length, 1);
  assert.equal(res.one_offs[0].description, 'M3 hex standoffs (historical)');
  assert.equal(res.one_offs[0].status, 'delivered');
  const mcmaster = res.vendors.find(v => v.name === 'McMaster-Carr');
  assert.ok(mcmaster, 'vendor auto-upserted from the one-off should appear');
  assert.equal(mcmaster.part_count, 1);
});

test('an issue followed by a delivered event is resolved', async () => {
  const cable = (await runOp(engine, 'get_dashboard_data', { project_id: projectId }) as Dashboard)
    .projects[0].items.find(i => i.description === 'bad cable')!;
  await runOp(engine, 'record_order_event', {
    project_id: projectId, line_item_id: cable.id, vendor: 'Amazon', event: 'delivered',
    event_at: new Date(Date.now() + 1000).toISOString(), raw_summary: 'replacement delivered',
  });
  const res = await runOp(engine, 'get_dashboard_data', { project_id: projectId }) as Dashboard;
  assert.equal(res.projects[0].open_issues, 0);
});

test('get_dashboard_data scoped to one project_id', async () => {
  const other = await runOp(engine, 'create_project', { name: 'other-project' }) as { id: string };
  const res = await runOp(engine, 'get_dashboard_data', { project_id: projectId }) as Dashboard;
  assert.ok(res.projects.every(p => p.id !== other.id));
  assert.ok(res.projects.some(p => p.id === projectId));
});
