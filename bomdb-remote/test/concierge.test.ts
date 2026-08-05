import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { runOp } from '../../bomdb/src/operations.ts';
import { getStartedText } from '../src/concierge.ts';

let empty: Engine;
let seeded: Engine;
let swept: Engine;

before(async () => {
  empty = await createTestEngine();
  seeded = await createTestEngine();
  swept = await createTestEngine();
  const p = await runOp(seeded, 'create_project', { name: 'brief-test' }) as { id: string };
  await runOp(seeded, 'upsert_spec', { project_id: p.id, category: 'power', spec: '5V USB' });
  await runOp(seeded, 'upsert_line_item', {
    project_id: p.id, description: 'sensor', qty: 1, unit_price: 12, status: 'po_placed',
    vendor: 'Digi-Key',
  });
  // A swept user: vendor + one-off historical purchase, no projects.
  await runOp(swept, 'upsert_line_item', {
    description: 'M3x10 SHCS, 100-pack', vendor: 'McMaster-Carr',
    status: 'delivered', source: 'email',
  });
});

after(async () => { await empty.close(); await seeded.close(); await swept.close(); });

test('new user gets the linear onboarding flow', async () => {
  const text = await getStartedText(empty);
  assert.match(text, /NEW USER/);
  // step 0: all four skill save-cards, before anything else
  assert.match(text, /skills\/vendor-sweep\/SKILL\.md/);
  assert.match(text, /skills\/part-search\/SKILL\.md/);
  assert.match(text, /skills\/gmail-orders\/SKILL\.md/);
  assert.match(text, /skills\/bom-dashboard\/SKILL\.md/);
  assert.match(text, /github\.com\/billenewman4\/procurement-pack/);
  assert.ok(
    text.indexOf('STEP 0') < text.indexOf('STEP 1'),
    'skills install before the vendor question');
  assert.ok(
    text.indexOf('vendor-sweep') < text.indexOf('scan\nyour last 6 months'),
    'skill fetch precedes the Gmail ask');
  // step 1: the single Gmail consent question, verbatim pieces
  assert.match(text, /scan\s+your last 6 months of email/i);
  assert.match(text, /everything before saving/i);
  // fallback: exactly the two alternatives
  assert.match(text, /Paste or upload a parts list/i);
  assert.match(text, /Start clean/i);
  // consent rule survives
  assert.match(text, /IN\s+THIS CONVERSATION/);
  // historical writes: one-offs, delivered, from email
  assert.match(text, /NO\s+project_id/);
  assert.match(text, /'delivered'/);
  // step 2: dashboard + digest as a scheduled task
  assert.match(text, /show me my BOM/);
  assert.match(text, /scheduled task/i);
  assert.match(text, /record_order_event/);
  // explicitly absent: design/spec interview, part search, project pressure
  assert.doesNotMatch(text, /interview/i);
  assert.doesNotMatch(text, /upsert_spec/);
  assert.doesNotMatch(text, /create_project/);
  assert.doesNotMatch(text, /what they're building/i);
});

test('digest prompt reflects the 4-status world', async () => {
  const text = await getStartedText(empty);
  assert.match(text, /researching →\s+rfq → po_placed → delivered/);
  assert.match(text, /EVENTS, not\s+statuses/);
  assert.match(text, /one-off/i);
  assert.match(text, /UPDATED/);
  assert.match(text, /UNMATCHED/);
  assert.match(text, /STALE/);
  assert.doesNotMatch(text, /category:purchases first[\s\S]*status "shipped"/);
});

test('returning user gets a briefing, not the welcome script', async () => {
  const text = await getStartedText(seeded);
  assert.doesNotMatch(text, /NEW USER/);
  assert.match(text, /brief-test/);
  assert.match(text, /po_placed/);
  // vendor CRM shows up in the briefing
  assert.match(text, /VENDORS \(1\)/);
  assert.match(text, /Digi-Key/);
  // missing spec categories are nudged
  assert.match(text, /constraints/i);
});

test('swept user (vendors + one-offs, no projects) is returning, not new', async () => {
  const text = await getStartedText(swept);
  assert.doesNotMatch(text, /NEW USER/);
  assert.match(text, /McMaster-Carr/);
  assert.match(text, /ONE-OFFS: 1/);
});
