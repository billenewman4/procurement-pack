import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

let engine: Engine;
let projectId: string;
let itemId: string;

before(async () => {
  engine = await createTestEngine();
  const p = await runOp(engine, 'create_project', { name: 'options-test' }) as { id: string };
  projectId = p.id;
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: projectId, description: 'CO2 sensor breakout', qty: 1, status: 'researching',
  }) as { id: string };
  itemId = li.id;
});

after(async () => { await engine.close(); });

test('add_line_item_option stores a candidate with provenance', async () => {
  const opt = await runOp(engine, 'add_line_item_option', {
    line_item_id: itemId, project_id: projectId, vendor: 'Adafruit',
    part_number: '5190', product_url: 'https://www.adafruit.com/product/5190',
    unit_price: 49.95, availability: 'in stock', fit_notes: 'STEMMA QT, exact match',
    source: 'search',
  }) as { id: string; status: string; source: string };
  assert.equal(opt.status, 'candidate');
  assert.equal(opt.source, 'search');

  const opt2 = await runOp(engine, 'add_line_item_option', {
    line_item_id: itemId, project_id: projectId, vendor: 'Mouser',
    unit_price: 44.1, source: 'sourcing_quote', quote_id: 'q_abc123',
    fit_notes: 'cheapest, 1-week lead',
  }) as { quote_id: string };
  assert.equal(opt2.quote_id, 'q_abc123');
});

test('add_line_item_option refuses an item from another project', async () => {
  const other = await runOp(engine, 'create_project', { name: 'other-proj' }) as { id: string };
  const res = await runOp(engine, 'add_line_item_option', {
    line_item_id: itemId, project_id: other.id, vendor: 'Sketchy',
  }) as { error?: string };
  assert.match(res.error ?? '', /not found in project/);
});

test('list_options returns candidates ordered by creation', async () => {
  const list = await runOp(engine, 'list_options', { line_item_id: itemId }) as { vendor: string }[];
  assert.equal(list.length, 2);
  assert.equal(list[0].vendor, 'Adafruit');
  assert.equal(list[1].vendor, 'Mouser');
});

test('select_option stamps the line item and rejects siblings', async () => {
  const list = await runOp(engine, 'list_options', { line_item_id: itemId }) as { id: string; vendor: string }[];
  const mouser = list.find(o => o.vendor === 'Mouser')!;
  const res = await runOp(engine, 'select_option', {
    option_id: mouser.id, project_id: projectId,
  }) as { line_item: { vendor: string; unit_price: string | number }; option: { status: string } };
  assert.equal(res.option.status, 'selected');
  assert.equal(res.line_item.vendor, 'Mouser');
  assert.equal(Number(res.line_item.unit_price), 44.1);

  const after_ = await runOp(engine, 'list_options', { line_item_id: itemId }) as { vendor: string; status: string }[];
  assert.equal(after_.find(o => o.vendor === 'Adafruit')!.status, 'rejected');
  assert.equal(after_.find(o => o.vendor === 'Mouser')!.status, 'selected');
});

test('get_dashboard_data carries items with their non-rejected options', async () => {
  const res = await runOp(engine, 'get_dashboard_data', { project_id: projectId }) as {
    projects: { items: { id: string; options: { vendor: string; status: string }[] }[] }[];
  };
  const item = res.projects[0].items.find(i => i.id === itemId);
  assert.ok(item, 'line item missing from dashboard');
  assert.equal(item.options.length, 1, 'rejected options should be excluded');
  assert.equal(item.options[0].vendor, 'Mouser');
  assert.equal(item.options[0].status, 'selected');
});
