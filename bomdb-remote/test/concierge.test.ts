import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { runOp } from '../../bomdb/src/operations.ts';
import { getStartedText } from '../src/concierge.ts';

let empty: Engine;
let seeded: Engine;

before(async () => {
  empty = await createTestEngine();
  seeded = await createTestEngine();
  const p = await runOp(seeded, 'create_project', { name: 'brief-test' }) as { id: string };
  await runOp(seeded, 'upsert_spec', { project_id: p.id, category: 'power', spec: '5V USB' });
  await runOp(seeded, 'upsert_line_item', {
    project_id: p.id, description: 'sensor', qty: 1, unit_price: 12, status: 'ordered',
  });
});

after(async () => { await empty.close(); await seeded.close(); });

test('new user gets the onboarding script', async () => {
  const text = await getStartedText(empty);
  assert.match(text, /NEW USER/);
  // the one-time spec interview categories
  assert.match(text, /power/i);
  assert.match(text, /constraints/i);
  // skill save-cards with raw GitHub URLs for all three skills
  assert.match(text, /skills\/part-search\/SKILL\.md/);
  assert.match(text, /skills\/gmail-orders\/SKILL\.md/);
  assert.match(text, /skills\/bom-dashboard\/SKILL\.md/);
  // self-contained digest task prompt (no skill dependency)
  assert.match(text, /scheduled task/i);
});

test('returning user gets a briefing, not the welcome script', async () => {
  const text = await getStartedText(seeded);
  assert.doesNotMatch(text, /NEW USER/);
  assert.match(text, /brief-test/);
  assert.match(text, /ordered/);
  // missing spec categories are nudged
  assert.match(text, /constraints/i);
});
