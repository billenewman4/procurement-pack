import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

let engine: Engine;
let sessionId: string;

before(async () => { engine = await createTestEngine(); });
after(async () => { await engine.close(); });

test('save_chat_session creates a session and returns it without items', async () => {
  const saved = await runOp(engine, 'save_chat_session', {
    title: 'Quote — M5 standoffs',
    items: [
      { kind: 'msg', role: 'user', text: 'I want to start a new quote.' },
      { kind: 'msg', role: 'assistant', text: 'How many do you need?' },
    ],
  }) as { id: string; title: string; items?: unknown };
  assert.ok(saved.id);
  assert.equal(saved.title, 'Quote — M5 standoffs');
  assert.equal(saved.items, undefined);
  sessionId = saved.id;
});

test('list_chat_sessions computes count and preview from the transcript', async () => {
  const list = await runOp(engine, 'list_chat_sessions', {}) as
    { id: string; count: number; preview: string }[];
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].preview, 'How many do you need?');
});

test('items replaces the transcript; append extends it', async () => {
  await runOp(engine, 'save_chat_session', {
    session_id: sessionId,
    items: [{ kind: 'msg', role: 'user', text: 'Actually make it 40 units.' }],
  });
  // An async agent posts progress without knowing the full transcript.
  await runOp(engine, 'save_chat_session', {
    session_id: sessionId,
    append: [{ kind: 'tool', text: 'Sourcing run started…' }],
    meta: { sourcing_job: 'job_123' },
  });
  const full = await runOp(engine, 'get_chat_session', { session_id: sessionId }) as
    { title: string; items: { kind: string; text: string }[]; meta: { sourcing_job: string } };
  assert.equal(full.items.length, 2);
  assert.equal(full.items[0].text, 'Actually make it 40 units.');
  assert.equal(full.items[1].kind, 'tool');
  assert.equal(full.meta.sourcing_job, 'job_123');
  // Title untouched by partial saves; meta merges rather than replaces.
  assert.equal(full.title, 'Quote — M5 standoffs');
  await runOp(engine, 'save_chat_session', { session_id: sessionId, meta: { live_url: 'https://x' } });
  const again = await runOp(engine, 'get_chat_session', { session_id: sessionId }) as
    { meta: Record<string, string> };
  assert.equal(again.meta.sourcing_job, 'job_123');
  assert.equal(again.meta.live_url, 'https://x');
});

test('a client-generated uuid is accepted as the session id', async () => {
  const id = '4bfae9c2-2f7f-4a0b-9c3e-1d2a33445566';
  const saved = await runOp(engine, 'save_chat_session', {
    session_id: id, title: 'From the UI', items: [],
  }) as { id: string };
  assert.equal(saved.id, id);
});

test('delete_chat_session removes the row', async () => {
  const res = await runOp(engine, 'delete_chat_session', { session_id: sessionId }) as { deleted: string };
  assert.equal(res.deleted, sessionId);
  const gone = await runOp(engine, 'get_chat_session', { session_id: sessionId }) as { error?: string };
  assert.match(gone.error ?? '', /no such session/);
});
