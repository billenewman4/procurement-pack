import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

const BOM_JSON = {
  project: { id: 'p1', name: 'arduino-dogfood', created_at: '2026-07-31' },
  specs: [
    { id: 's1', category: 'power', spec: '12V rail, max 3A; barrel jack in', updated_at: '2026-07-31' },
  ],
  line_items: [
    { id: 'li1', description: 'step-down converter 12V→5V 3A', part_number: null,
      vendor: 'Amazon', product_url: null, qty: 2, unit_price: 11.99, status: 'ordered',
      source: 'search', ordered_at: '2026-07-31', eta: '2026-08-02', notes: null,
      chosen_because: '12V rail, 400mA < 3A budget', outcome: 'worked',
      outcome_notes: 'browned out under pump inrush until cap added' },
  ],
  order_events: [
    { id: 'oe1', line_item_id: 'li1', vendor: 'Amazon', order_number: '112-4477',
      event: 'confirmed', event_at: '2026-07-31T18:04:00Z', tracking_url: null,
      email_ref: null, raw_summary: 'Amazon order 112-4477 confirmed' },
  ],
  last_email_sync: '2026-07-31T18:00:00Z',
};

test('import_json → export_json round-trips Bill\'s bom.json shape', async () => {
  const engine = await createTestEngine();
  const imported = await runOp(engine, 'import_json', { bom: BOM_JSON }) as { project_id: string };
  assert.ok(imported.project_id);
  const out = await runOp(engine, 'export_json', { project_id: imported.project_id }) as typeof BOM_JSON;
  assert.equal(out.project.name, 'arduino-dogfood');
  assert.equal(out.specs.length, 1);
  assert.equal(out.line_items.length, 1);
  assert.equal(out.line_items[0].unit_price, 11.99);
  assert.equal(out.line_items[0].eta, '2026-08-02'); // date-only, matching bom.json
  // legacy status values remap on import (ordered → po_placed)
  assert.equal(out.line_items[0].status, 'po_placed');
  // provenance fields survive the round trip
  assert.equal(out.line_items[0].chosen_because, '12V rail, 400mA < 3A budget');
  assert.equal(out.line_items[0].outcome, 'worked');
  assert.equal(out.line_items[0].outcome_notes, 'browned out under pump inrush until cap added');
  assert.equal(out.order_events.length, 1);
  // the link survived the id remap
  assert.equal(out.order_events[0].line_item_id, out.line_items[0].id);
  assert.equal(out.last_email_sync, '2026-07-31T18:04:00.000Z'); // derived: max(event_at)
  await engine.close();
});
