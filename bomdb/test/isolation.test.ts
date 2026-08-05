import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, ensureSchema, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

// Hosted-mode isolation: two scoped roles must never see or touch each
// other's rows, across every operation. The engine connection is the table
// owner (bypasses RLS); SET ROLE simulates each scoped user's connection.

let engine: Engine;
let aliceProject: string;
let bobProject: string;
let bobItem: string;

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await engine.query(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await engine.query(`RESET ROLE`);
  }
}

before(async () => {
  engine = await createTestEngine();
  // Provision two scoped users the way scripts/provision-user.ts does.
  for (const who of ['alice', 'bob']) {
    await engine.query(`CREATE ROLE ${who}_r LOGIN`);
    await engine.query(`GRANT USAGE ON SCHEMA public TO ${who}_r`);
    await engine.query(`GRANT SELECT ON users TO ${who}_r`);
    await engine.query(
      `GRANT SELECT, INSERT, UPDATE ON projects, project_specs, line_items, order_events, line_item_options, vendors TO ${who}_r`);
    await engine.query(
      `INSERT INTO users (name, email, sharing, pg_role) VALUES ($1, $2, 'hosted', $3)`,
      [who, `${who}@example.com`, `${who}_r`]);
  }
  // Each user creates a project with content, as themselves.
  aliceProject = await asRole('alice_r', async () => {
    const p = await runOp(engine, 'create_project', { name: 'alice-proj' }) as { id: string };
    await runOp(engine, 'upsert_spec', { project_id: p.id, category: 'power', spec: '5V only' });
    return p.id;
  });
  bobProject = await asRole('bob_r', async () => {
    const p = await runOp(engine, 'create_project', { name: 'bob-proj' }) as { id: string };
    const li = await runOp(engine, 'upsert_line_item', {
      project_id: p.id, description: 'bob part', status: 'po_placed', vendor: 'BobVendorCo',
    }) as { id: string };
    bobItem = li.id;
    return p.id;
  });
});
after(async () => { await engine.close(); });

test('create_project stamps the scoped user_id', async () => {
  const [row] = await engine.query<{ user_id: string | null }>(
    `SELECT user_id FROM projects WHERE id = $1`, [aliceProject]);
  assert.ok(row.user_id, 'user_id should be stamped for scoped creator');
});

test('list_projects shows only your own', async () => {
  const seen = await asRole('alice_r', async () =>
    await runOp(engine, 'list_projects', {}) as { name: string }[]);
  assert.deepEqual(seen.map(p => p.name), ['alice-proj']);
});

test('users table shows only your own row', async () => {
  const rows = await asRole('alice_r', async () =>
    engine.query<{ email: string }>(`SELECT email FROM users`));
  assert.deepEqual(rows.map(r => r.email), ['alice@example.com']);
});

test('get_project_context on another user\'s project is not found', async () => {
  const res = await asRole('alice_r', async () =>
    await runOp(engine, 'get_project_context', { project_id: bobProject }) as { error?: string });
  assert.match(res.error ?? '', /not found/);
});

test('cannot write specs, items, or events into another user\'s project', async () => {
  await asRole('alice_r', async () => {
    const spec = await runOp(engine, 'upsert_spec', {
      project_id: bobProject, category: 'power', spec: 'hijack',
    }) as { error?: string };
    assert.ok(spec.error, 'spec write should fail');
    const li = await runOp(engine, 'upsert_line_item', {
      project_id: bobProject, description: 'hijack part',
    }) as { error?: string };
    assert.ok(li.error, 'line item write should fail');
    const ev = await runOp(engine, 'record_order_event', {
      project_id: bobProject, vendor: 'X', event: 'confirmed',
      event_at: '2026-08-02T00:00:00Z', raw_summary: 'hijack',
    }) as { error?: string };
    assert.ok(ev.error, 'order event write should fail');
  });
});

test('cannot move another user\'s line item through update_status, set_outcome, or set_item_active', async () => {
  await asRole('alice_r', async () => {
    const st = await runOp(engine, 'update_status', {
      line_item_id: bobItem, status: 'delivered',
    }) as { error?: string };
    assert.match(st.error ?? '', /not found/);
    const oc = await runOp(engine, 'set_outcome', {
      line_item_id: bobItem, outcome: 'failed',
    }) as { error?: string };
    assert.match(oc.error ?? '', /not found/);
    const act = await runOp(engine, 'set_item_active', {
      line_item_id: bobItem, active: false,
    }) as { error?: string };
    assert.match(act.error ?? '', /not found/);
  });
  // and bob's item is untouched
  const [row] = await engine.query<{ status: string; outcome: string | null; active: boolean }>(
    `SELECT status, outcome, active FROM line_items WHERE id = $1`, [bobItem]);
  assert.equal(row.status, 'po_placed');
  assert.equal(row.outcome, null);
  assert.equal(row.active, true);
});

test('vendors are isolated: alice cannot see, match, or rename bob\'s vendor', async () => {
  await asRole('alice_r', async () => {
    const seen = await runOp(engine, 'list_vendors', { include_inactive: true }) as { name: string }[];
    assert.equal(seen.length, 0, 'alice should see no vendors yet');
    // same name upserts a NEW vendor for alice, not a merge into bob's
    const mine = await runOp(engine, 'upsert_vendor', { name: 'BobVendorCo' }) as { id: string; user_id: string };
    assert.ok(mine.id);
    const list = await runOp(engine, 'list_vendors', {}) as { id: string }[];
    assert.deepEqual(list.map(v => v.id), [mine.id]);
  });
  const rows = await engine.query<{ id: string }>(
    `SELECT id FROM vendors WHERE lower(name) = lower('BobVendorCo')`);
  assert.equal(rows.length, 2, 'bob and alice each own a distinct vendor row');
});

test('rename_project cannot touch another user\'s project', async () => {
  const res = await asRole('alice_r', async () =>
    await runOp(engine, 'rename_project', { project_id: bobProject, name: 'hijacked' }) as { error?: string });
  assert.match(res.error ?? '', /not found/);
  const [row] = await engine.query<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [bobProject]);
  assert.equal(row.name, 'bob-proj');
});

test('one-off items (no project) stay scoped to their owner', async () => {
  const oneOff = await asRole('bob_r', async () =>
    await runOp(engine, 'upsert_line_item', {
      description: 'bob one-off standoffs', status: 'delivered',
    }) as { id: string; project_id: string | null });
  assert.equal(oneOff.project_id, null);
  await asRole('alice_r', async () => {
    const dash = await runOp(engine, 'get_dashboard_data', {}) as { one_offs: { id: string }[] };
    assert.ok(dash.one_offs.every(i => i.id !== oneOff.id), 'alice must not see bob\'s one-off');
    const touch = await runOp(engine, 'set_item_active', {
      line_item_id: oneOff.id, active: false,
    }) as { error?: string };
    assert.match(touch.error ?? '', /not found/);
  });
});

test('export_json and stale_orders stay scoped', async () => {
  await asRole('alice_r', async () => {
    const exp = await runOp(engine, 'export_json', { project_id: bobProject }) as { error?: string };
    assert.match(exp.error ?? '', /not found/);
    const stale = await runOp(engine, 'stale_orders', {}) as { description: string }[];
    assert.equal(stale.length, 0, 'bob\'s ordered item must not appear in alice\'s stale list');
  });
});

test('scoped roles have no DELETE privilege at all', async () => {
  const res = await asRole('bob_r', async () =>
    await runOp(engine, 'update_status', { line_item_id: bobItem, status: 'delivered' }) as { status: string });
  assert.equal(res.status, 'delivered'); // own writes still work...
  const del = await asRole('bob_r', async () => {
    try {
      await engine.query(`DELETE FROM line_items WHERE id = $1`, [bobItem]);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });
  assert.match((del as { error?: string }).error ?? '', /permission denied/i);
});

test('ensureSchema succeeds for a scoped role with no DDL permission', async () => {
  // Server startup must not crash for scoped users: initSchema fails on
  // permission, the probe confirms tables exist, startup continues.
  await asRole('alice_r', async () => {
    await ensureSchema(engine); // must not throw
  });
});

test('the owner connection still sees everything (founders/master path)', async () => {
  const all = await runOp(engine, 'list_projects', {}) as { name: string }[];
  const names = all.map(p => p.name).sort();
  assert.ok(names.includes('alice-proj') && names.includes('bob-proj'));
});
