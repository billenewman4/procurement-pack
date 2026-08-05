import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

let engine: Engine;
before(async () => { engine = await createTestEngine(); });
after(async () => { await engine.close(); });

test('upsert_vendor creates, then merges by case-insensitive name', async () => {
  const created = await runOp(engine, 'upsert_vendor', {
    name: 'McMaster-Carr', domains: ['mcmaster.com'], source: 'email_sweep',
  }) as { id: string; name: string; domains: string[]; source: string; active: boolean };
  assert.ok(created.id);
  assert.deepEqual(created.domains, ['mcmaster.com']);
  assert.equal(created.source, 'email_sweep');
  assert.equal(created.active, true);

  const merged = await runOp(engine, 'upsert_vendor', {
    name: 'MCMASTER-carr', domains: ['mcmaster.com', 'email.mcmaster.com'],
    website: 'https://www.mcmaster.com', notes: 'fast shipping',
  }) as { id: string; name: string; domains: string[]; website: string; notes: string };
  assert.equal(merged.id, created.id, 'same vendor row, matched by lower(name)');
  assert.equal(merged.name, 'McMaster-Carr', 'original name kept');
  assert.deepEqual(merged.domains.sort(), ['email.mcmaster.com', 'mcmaster.com']);
  assert.equal(merged.website, 'https://www.mcmaster.com');
  assert.equal(merged.notes, 'fast shipping');
});

test('upsert_vendor matches by overlapping domain when the name differs', async () => {
  const byDomain = await runOp(engine, 'upsert_vendor', {
    name: 'McMaster', domains: ['mcmaster.com'],
  }) as { id: string; name: string };
  const canonical = await runOp(engine, 'upsert_vendor', { name: 'McMaster-Carr' }) as { id: string };
  assert.equal(byDomain.id, canonical.id, 'domain overlap resolves to the same vendor');
  assert.equal(byDomain.name, 'McMaster-Carr', 'existing name is not clobbered');
});

test('upsert_line_item with a vendor name auto-upserts and links the vendor', async () => {
  const p = await runOp(engine, 'create_project', { name: 'vendor-link-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'M3 socket head screws', vendor: 'mcmaster-carr',
  }) as { id: string; vendor: string; vendor_id: string };
  assert.ok(li.vendor_id, 'vendor_id linked from the name');
  assert.equal(li.vendor, 'McMaster-Carr', 'canonical CRM name stamped');
  const vendors = await runOp(engine, 'list_vendors', {}) as { id: string }[];
  assert.equal(vendors.length, 1, 'no duplicate vendor rows from case variants');
  assert.equal(vendors[0].id, li.vendor_id);
});

test('upsert_line_item accepts vendor_id directly and rejects unknown ones', async () => {
  const p = await runOp(engine, 'create_project', { name: 'vendor-id-test' }) as { id: string };
  const [v] = await runOp(engine, 'list_vendors', {}) as { id: string; name: string }[];
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'washers', vendor_id: v.id,
  }) as { vendor: string; vendor_id: string };
  assert.equal(li.vendor_id, v.id);
  assert.equal(li.vendor, v.name);
  const bad = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'nope', vendor_id: '00000000-0000-0000-0000-000000000000',
  }) as { error: string };
  assert.match(bad.error, /vendor .* not found/);
});

test('one-off line items need no project and default sensibly', async () => {
  const li = await runOp(engine, 'upsert_line_item', {
    description: 'historical purchase: pump', vendor: 'Amazon', status: 'delivered',
  }) as { id: string; project_id: string | null; status: string; active: boolean };
  assert.equal(li.project_id, null);
  assert.equal(li.status, 'delivered');
  assert.equal(li.active, true);
  // updatable without a project_id
  const upd = await runOp(engine, 'upsert_line_item', {
    id: li.id, description: 'historical purchase: pump', qty: 2,
  }) as { qty: number };
  assert.equal(upd.qty, 2);
});

test('list_vendors rolls up parts (incl. inactive), open items, last activity', async () => {
  const p = await runOp(engine, 'create_project', { name: 'rollup-test' }) as { id: string };
  const open = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'live part', vendor: 'RollupVendor', status: 'po_placed',
  }) as { id: string };
  const hidden = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'replaced part', vendor: 'RollupVendor', status: 'delivered',
  }) as { id: string };
  await runOp(engine, 'set_item_active', { line_item_id: hidden.id, active: false });
  const vendors = await runOp(engine, 'list_vendors', {}) as {
    name: string; part_count: number; open_items: number; last_activity: string | null;
    parts: { id: string; active: boolean }[];
  }[];
  const v = vendors.find(x => x.name === 'RollupVendor')!;
  assert.equal(v.part_count, 2, 'inactive/historical parts still count');
  assert.equal(v.open_items, 1, 'only active undelivered items are open');
  assert.ok(v.last_activity, 'last activity present');
  assert.deepEqual(v.parts.map(x => x.id).sort(), [open.id, hidden.id].sort());
});

test('inactive vendors are hidden unless include_inactive', async () => {
  await runOp(engine, 'upsert_vendor', { name: 'DefunctCo', active: false });
  const visible = await runOp(engine, 'list_vendors', {}) as { name: string }[];
  assert.ok(!visible.some(v => v.name === 'DefunctCo'));
  const all = await runOp(engine, 'list_vendors', { include_inactive: true }) as { name: string }[];
  assert.ok(all.some(v => v.name === 'DefunctCo'));
});

test('set_item_active toggles and returns the row', async () => {
  const li = await runOp(engine, 'upsert_line_item', { description: 'toggle me' }) as { id: string };
  const off = await runOp(engine, 'set_item_active', { line_item_id: li.id, active: false }) as { active: boolean };
  assert.equal(off.active, false);
  const on = await runOp(engine, 'set_item_active', { line_item_id: li.id, active: true }) as { active: boolean };
  assert.equal(on.active, true);
  const missing = await runOp(engine, 'set_item_active', {
    line_item_id: '00000000-0000-0000-0000-000000000000', active: false,
  }) as { error: string };
  assert.match(missing.error, /not found/);
});

test('rename_project renames and errors cleanly on a bad id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'old-name' }) as { id: string };
  const renamed = await runOp(engine, 'rename_project', { project_id: p.id, name: 'new-name' }) as { name: string };
  assert.equal(renamed.name, 'new-name');
  const missing = await runOp(engine, 'rename_project', {
    project_id: '00000000-0000-0000-0000-000000000000', name: 'x',
  }) as { error: string };
  assert.match(missing.error, /not found/);
});

test('upsert_vendor round-trips sourcing_slug, filling blank and overwriting on demand', async () => {
  const created = await runOp(engine, 'upsert_vendor', {
    name: 'Newark', domains: ['newark.com'], sourcing_slug: 'element14',
  }) as { id: string; sourcing_slug: string };
  assert.equal(created.sourcing_slug, 'element14');

  // omitted on a later call: existing slug survives (COALESCE keeps it)
  const untouched = await runOp(engine, 'upsert_vendor', {
    name: 'Newark', notes: 'fast shipping',
  }) as { id: string; sourcing_slug: string };
  assert.equal(untouched.id, created.id);
  assert.equal(untouched.sourcing_slug, 'element14');

  // explicitly passed: overwrites
  const updated = await runOp(engine, 'upsert_vendor', {
    name: 'Newark', sourcing_slug: 'newark-v2',
  }) as { sourcing_slug: string };
  assert.equal(updated.sourcing_slug, 'newark-v2');

  // list_vendors surfaces it too
  const vendors = await runOp(engine, 'list_vendors', {}) as { name: string; sourcing_slug: string }[];
  const v = vendors.find(x => x.name === 'Newark')!;
  assert.equal(v.sourcing_slug, 'newark-v2');
});

test('upsert_vendor leaves sourcing_slug null when never provided', async () => {
  const created = await runOp(engine, 'upsert_vendor', { name: 'NoSlugCo' }) as { sourcing_slug: string | null };
  assert.equal(created.sourcing_slug, null);
});
