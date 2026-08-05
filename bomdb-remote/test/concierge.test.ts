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
  // step 0: welcome-gate — explain, then stop and wait for "continue"
  assert.ok(
    text.indexOf('STEP 0') < text.indexOf('STEP 1'),
    'welcome comes before the skills+sweep step');
  assert.match(text, /WELCOME, before anything else/);
  assert.match(text, /Ready\? Say continue\./);
  assert.match(text, /Do not fetch\s+skills, call tools/);
  // step 1a: surface-conditional — stub cards on chat, silent skip in Code
  assert.match(text, /get_skill/);
  assert.match(text, /vendor-sweep,\s+part-search,\s+gmail-orders, bom-dashboard/);
  assert.match(text, /form 'stub'/);
  assert.match(text, /never go\s+stale/i);
  assert.match(text, /Claude Code \(no save cards\): SKIP/);
  assert.match(text, /NEVER fetch skill files from GitHub URLs/);
  // step 2: live dashboard on publish-capable surfaces, snapshot elsewhere
  assert.match(text, /dashboard\/vendor-crm-live\.html/);
  assert.match(text, /claude\.ai\/code/);
  assert.doesNotMatch(text, /raw\.githubusercontent/);
  assert.match(text, /github\.com\/billenewman4\/procurement-pack/);
  assert.ok(
    text.indexOf('Save these while I go through your email') < text.indexOf('run the sweep'),
    'skill cards precede the sweep in step 1');
  // continue doubles as email consent; everything shown before saving
  assert.match(text, /"continue" counts as email consent/);
  assert.match(text, /NOTHING is saved until they approve/);
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

test('new-user script has no connect_vendor step when sourcing is not configured', async () => {
  const saved = process.env.SOURCING_AGENT_URL;
  delete process.env.SOURCING_AGENT_URL;
  try {
    const text = await getStartedText(empty);
    assert.doesNotMatch(text, /connect_vendor/);
  } finally {
    process.env.SOURCING_AGENT_URL = saved;
  }
});

test('new-user script adds a fire-and-forget connect_vendor step when sourcing is configured', async () => {
  const saved = process.env.SOURCING_AGENT_URL;
  process.env.SOURCING_AGENT_URL = 'http://127.0.0.1:1/mcp/fake-token';
  try {
    const text = await getStartedText(empty);
    assert.match(text, /connect_vendor/);
    assert.match(text, /sourcing_slug/);
    assert.match(text, /do NOT wait for it or poll/);
    // lands after the vendor/line-item writes, still inside step 1
    assert.ok(
      text.indexOf('upsert_vendor per vendor, then upsert_line_item per part') < text.indexOf('connect_vendor with'),
      'connect_vendor step should follow the vendor/line-item writes');
    assert.ok(
      text.indexOf('connect_vendor with') < text.indexOf('STEP 2'),
      'connect_vendor step should stay inside step 1, before step 2');
  } finally {
    process.env.SOURCING_AGENT_URL = saved;
  }
});
