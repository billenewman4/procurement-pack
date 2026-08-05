import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Engine } from '../src/engine.ts';
import { migrate } from '../scripts/migrate-lib.ts';

// The 2026-08-04 vendor-CRM migration, replayed against a database built with
// the PRE-redesign schema and seeded with legacy data. PGLite is a real
// Postgres, so what passes here is what the hosted run will do.

const SCHEMA = readFileSync(
  fileURLToPath(new URL('../src/schema.sql', import.meta.url)), 'utf8');

// The schema as it stood before the redesign (tables only — the migration
// itself recreates the RLS policies via schema.sql).
const OLD_SCHEMA = `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  sharing text NOT NULL DEFAULT 'hosted',
  created_at timestamptz NOT NULL DEFAULT now(),
  pg_role text UNIQUE
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  spec text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);
CREATE TABLE line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description text NOT NULL,
  part_number text,
  vendor text,
  product_url text,
  qty int NOT NULL DEFAULT 1,
  unit_price numeric(10,2),
  status text NOT NULL DEFAULT 'needed'
    CHECK (status IN ('needed','researching','ordered','shipped','delivered','issue')),
  source text NOT NULL DEFAULT 'manual',
  ordered_at timestamptz,
  eta date,
  notes text,
  chosen_because text,
  outcome text,
  outcome_notes text
);
CREATE TABLE line_item_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  part_number text,
  unit_price numeric(10,2),
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid REFERENCES line_items(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  order_number text,
  event text NOT NULL,
  event_at timestamptz NOT NULL,
  tracking_url text,
  email_ref text,
  raw_summary text
);
`;

let db: PGlite;
let engine: Engine;
const ids: Record<string, string> = {};

async function seedItem(key: string, project: string, description: string,
  vendor: string | null, status: string, orderedAt?: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO line_items (project_id, description, vendor, status, ordered_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [ids[project], description, vendor, status, orderedAt ?? null]);
  ids[key] = res.rows[0].id;
}

before(async () => {
  db = new PGlite();
  engine = {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params.map(v => (v === undefined ? null : v)));
      return res.rows as T[];
    },
    async initSchema() { await db.exec(SCHEMA); },
    async close() { await db.close(); },
  };
  await db.exec(OLD_SCHEMA);
  await db.query(`CREATE ROLE eshan_r LOGIN`); // exercises the grant loop
  const eshan = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, pg_role) VALUES ('eshan','e@x.com','eshan_r') RETURNING id`);
  const bill = await db.query<{ id: string }>(
    `INSERT INTO users (name, email) VALUES ('bill','b@x.com') RETURNING id`);
  ids.eshan = eshan.rows[0].id;
  ids.bill = bill.rows[0].id;
  for (const [key, user] of [['pe', ids.eshan], ['pb', ids.bill], ['plocal', null]] as const) {
    const res = await db.query<{ id: string }>(
      `INSERT INTO projects (name, user_id) VALUES ($1,$2) RETURNING id`, [key, user]);
    ids[key] = res.rows[0].id;
  }
  await seedItem('needed', 'pe', 'buck converter', 'Amazon', 'needed');
  await seedItem('ordered', 'pe', 'pump', 'amazon', 'ordered'); // case variant of the same vendor
  await seedItem('shipped_no_ev', 'pe', 'sensor', 'Digi-Key', 'shipped', '2026-07-20T00:00:00Z');
  await seedItem('shipped_has_ev', 'pe', 'cable', 'Digi-Key', 'shipped', '2026-07-21T00:00:00Z');
  await seedItem('issue', 'pb', 'valve', 'McMaster', 'issue');
  await seedItem('delivered', 'pb', 'enclosure', '', 'delivered'); // empty vendor → no CRM row
  await seedItem('researching', 'plocal', 'led strip', 'Adafruit', 'researching');
  await db.query(
    `INSERT INTO order_events (line_item_id, project_id, vendor, event, event_at, raw_summary)
     VALUES ($1,$2,'Digi-Key','shipped','2026-07-22T00:00:00Z','already had a shipped event')`,
    [ids.shipped_has_ev, ids.pe]);
  await db.query(
    `INSERT INTO line_item_options (line_item_id, project_id, vendor, unit_price)
     VALUES ($1,$2,'Mouser',44.10)`, [ids.needed, ids.pe]);
  await migrate(engine);
});
after(async () => { await engine.close(); });

test('legacy statuses remap per the design-doc table', async () => {
  const rows = await engine.query<{ id: string; status: string }>(`SELECT id, status FROM line_items`);
  const status = (key: string) => rows.find(r => r.id === ids[key])!.status;
  assert.equal(status('needed'), 'researching');
  assert.equal(status('ordered'), 'po_placed');
  assert.equal(status('shipped_no_ev'), 'po_placed');
  assert.equal(status('shipped_has_ev'), 'po_placed');
  assert.equal(status('issue'), 'po_placed');
  assert.equal(status('delivered'), 'delivered');
  assert.equal(status('researching'), 'researching');
});

test('compensating order_events exist exactly once', async () => {
  const count = async (key: string, event: string) =>
    (await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM order_events WHERE line_item_id = $1 AND event = $2`,
      [ids[key], event]))[0].n;
  assert.equal(await count('shipped_no_ev', 'shipped'), 1, 'shipped event inserted');
  assert.equal(await count('shipped_has_ev', 'shipped'), 1, 'existing shipped event not duplicated');
  assert.equal(await count('issue', 'issue'), 1, 'issue event inserted');
});

test('vendors extracted per user, case-insensitively, and linked', async () => {
  const vendors = await engine.query<{ id: string; user_id: string | null; name: string; source: string }>(
    `SELECT id, user_id, name, source FROM vendors ORDER BY name`);
  // compare case-insensitively: which case variant DISTINCT ON keeps is
  // collation-dependent — the point is ONE row per (user, lower(name))
  const byUser = (uid: string | null) =>
    vendors.filter(v => v.user_id === uid).map(v => v.name.toLowerCase()).sort();
  assert.deepEqual(byUser(ids.eshan), ['amazon', 'digi-key', 'mouser']); // one Amazon despite case variants
  assert.deepEqual(byUser(ids.bill), ['mcmaster']); // empty-string vendor produced no row
  assert.deepEqual(byUser(null), ['adafruit']);
  assert.ok(vendors.every(v => v.source === 'manual'));
  const items = await engine.query<{ id: string; vendor: string | null; vendor_id: string | null; user_id: string | null }>(
    `SELECT id, vendor, vendor_id, user_id FROM line_items`);
  for (const it of items) {
    if (it.vendor) assert.ok(it.vendor_id, `item with vendor "${it.vendor}" should be linked`);
    else assert.equal(it.vendor_id, null);
  }
  // case-variant strings resolve to the same vendor row
  const needed = items.find(i => i.id === ids.needed)!;
  const ordered = items.find(i => i.id === ids.ordered)!;
  assert.equal(needed.vendor_id, ordered.vendor_id);
  // user_id backfilled from the owning project
  assert.equal(needed.user_id, ids.eshan);
  const [opt] = await engine.query<{ vendor_id: string | null }>(
    `SELECT vendor_id FROM line_item_options WHERE line_item_id = $1`, [ids.needed]);
  assert.ok(opt.vendor_id, 'option linked to the Mouser vendor row');
});

test('the new status CHECK is enforced after migration', async () => {
  await assert.rejects(
    engine.query(`INSERT INTO line_items (project_id, description, status) VALUES ($1,'x','needed')`, [ids.pe]),
    /check|constraint/i);
});

test('order_events gain an owner scope and a nullable project_id', async () => {
  const events = await engine.query<{ user_id: string | null; project_id: string | null }>(
    `SELECT user_id, project_id FROM order_events
     WHERE line_item_id = $1 OR line_item_id = $2`, [ids.shipped_has_ev, ids.shipped_no_ev]);
  assert.equal(events.length, 2, 'pre-existing + compensating event');
  assert.ok(events.every(e => e.user_id === ids.eshan),
    'user_id backfilled from the owning project, incl. compensating events');
  // one-off events (no project) are now storable
  await engine.query(
    `INSERT INTO order_events (line_item_id, project_id, user_id, vendor, event, event_at, raw_summary)
     VALUES (NULL, NULL, $1, 'X', 'issue', now(), 'one-off event post-migration')`, [ids.eshan]);
});

test('sourcing_slug column exists, nullable, and is writable post-migration', async () => {
  const [col] = await engine.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'vendors' AND column_name = 'sourcing_slug'`);
  assert.ok(col, 'sourcing_slug column missing after migration');
  assert.equal(col.is_nullable, 'YES');
  const [amazon] = await engine.query<{ id: string }>(
    `SELECT id FROM vendors WHERE lower(name) = 'amazon' AND user_id = $1`, [ids.eshan]);
  const [updated] = await engine.query<{ sourcing_slug: string }>(
    `UPDATE vendors SET sourcing_slug = 'amazon-business' WHERE id = $1 RETURNING sourcing_slug`,
    [amazon.id]);
  assert.equal(updated.sourcing_slug, 'amazon-business');
});

test('rerunning the migration changes nothing', async () => {
  const snapshot = async () => ({
    vendors: (await engine.query<{ n: number }>(`SELECT count(*)::int AS n FROM vendors`))[0].n,
    events: (await engine.query<{ n: number }>(`SELECT count(*)::int AS n FROM order_events`))[0].n,
    statuses: await engine.query(`SELECT id, status FROM line_items ORDER BY id`),
  });
  const beforeRerun = await snapshot();
  await migrate(engine);
  assert.deepEqual(await snapshot(), beforeRerun);
});
