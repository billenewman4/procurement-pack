// The migration body, split from migrate.ts for testability (same pattern as
// provision-lib.ts): test/migrate.test.ts replays it against an old-schema
// PGLite and asserts the data moves — and moves only once.
//
// 2026-08-04 vendor-CRM redesign, on top of the base schema apply:
//   1. DDL adds run BEFORE schema.sql (its new RLS policies reference the
//      vendors table and the new line_items columns).
//   2. Legacy statuses remap to the four-state lifecycle — needed→researching,
//      ordered→po_placed, shipped/issue→po_placed with a compensating
//      order_event inserted when the item doesn't already have one.
//   3. Distinct non-empty vendor strings become vendors rows per user
//      (source 'manual'), and vendor_id is backfilled on line_items and
//      line_item_options.
// Every step no-ops on rerun.
import type { Engine } from '../src/engine.ts';

export async function migrate(engine: Engine): Promise<void> {
  // Fresh database (no line_items yet): schema.sql alone builds the final
  // shape — skip straight to it, there is nothing to migrate.
  const [{ existing }] = await engine.query<{ existing: boolean }>(
    `SELECT to_regclass('public.line_items') IS NOT NULL AS existing`);

  if (existing) {
    // ---- 1. DDL adds (mirrors schema.sql; IF NOT EXISTS throughout) ----
    await engine.query(
      `CREATE TABLE IF NOT EXISTS vendors (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id uuid REFERENCES users(id),
         name text NOT NULL,
         domains text[] NOT NULL DEFAULT '{}',
         contact_email text,
         website text,
         notes text,
         source text NOT NULL DEFAULT 'manual'
           CHECK (source IN ('email_sweep','manual','sourcing_agent')),
         active boolean NOT NULL DEFAULT true,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`);
    await engine.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS vendors_user_lower_name
       ON vendors ((COALESCE(user_id::text, '')), lower(name))`);
    // 2026-08-04 sourcing-agent v2: canonical vendor slug from connect_vendor.
    // A plain ALTER, not part of the CREATE TABLE above — that statement is
    // IF NOT EXISTS and no-ops on a vendors table that already exists from an
    // earlier run of this same migration.
    await engine.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS sourcing_slug text`);
    await engine.query(`ALTER TABLE line_items ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id)`);
    await engine.query(`ALTER TABLE line_items ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`);
    await engine.query(`ALTER TABLE line_items ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`);
    await engine.query(`ALTER TABLE line_items ALTER COLUMN project_id DROP NOT NULL`);
    await engine.query(`ALTER TABLE line_items ALTER COLUMN status SET DEFAULT 'researching'`);
    await engine.query(`ALTER TABLE line_item_options ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id)`);
    // Events on one-off items carry no project — nullable project_id plus a
    // user_id owner scope, mirroring line_items.
    await engine.query(`ALTER TABLE order_events ALTER COLUMN project_id DROP NOT NULL`);
    await engine.query(`ALTER TABLE order_events ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`);
    console.log('DDL adds applied');

    // line_items.user_id backfills from the owning project so RLS and rollups
    // can scope items uniformly (one-offs get it stamped at insert).
    await engine.query(
      `UPDATE line_items li SET user_id = p.user_id
       FROM projects p
       WHERE p.id = li.project_id AND li.user_id IS NULL AND p.user_id IS NOT NULL`);

    // ---- 2. Status remap (drop the CHECK so rows can move; recreate after) ----
    await engine.query(`ALTER TABLE line_items DROP CONSTRAINT IF EXISTS line_items_status_check`);
    const shipped = await engine.query(
      `INSERT INTO order_events (line_item_id, project_id, vendor, event, event_at, raw_summary)
       SELECT li.id, li.project_id, COALESCE(NULLIF(trim(li.vendor), ''), 'unknown'), 'shipped',
              COALESCE(li.ordered_at, now()),
              'migrated: legacy status "shipped" → po_placed + shipped event'
       FROM line_items li
       WHERE li.status = 'shipped' AND li.project_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM order_events oe
                         WHERE oe.line_item_id = li.id AND oe.event = 'shipped')
       RETURNING id`);
    const issues = await engine.query(
      `INSERT INTO order_events (line_item_id, project_id, vendor, event, event_at, raw_summary)
       SELECT li.id, li.project_id, COALESCE(NULLIF(trim(li.vendor), ''), 'unknown'), 'issue',
              COALESCE(li.ordered_at, now()),
              'migrated: legacy status "issue" → po_placed + issue event'
       FROM line_items li
       WHERE li.status = 'issue' AND li.project_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM order_events oe
                         WHERE oe.line_item_id = li.id AND oe.event = 'issue')
       RETURNING id`);
    const remapped = await engine.query(
      `UPDATE line_items SET status = CASE status
         WHEN 'needed'  THEN 'researching'
         WHEN 'ordered' THEN 'po_placed'
         WHEN 'shipped' THEN 'po_placed'
         WHEN 'issue'   THEN 'po_placed'
       END
       WHERE status IN ('needed','ordered','shipped','issue')
       RETURNING id`);
    // Transitional superset: rows may already hold the 2026-08-06 names on a
    // rerun; step 2b below replaces this with the strict final constraint.
    await engine.query(
      `ALTER TABLE line_items ADD CONSTRAINT line_items_status_check
       CHECK (status IN ('researching','rfq','po_placed','delivered',
                         'quoting','cart','ordered'))`);
    // order_events.user_id backfill runs AFTER the compensating inserts so
    // they get an owner scope too.
    await engine.query(
      `UPDATE order_events oe SET user_id = p.user_id
       FROM projects p
       WHERE p.id = oe.project_id AND oe.user_id IS NULL AND p.user_id IS NOT NULL`);
    console.log(`statuses remapped: ${remapped.length} item(s), ${shipped.length} shipped event(s), ${issues.length} issue event(s) inserted`);

    // ---- 2b. 2026-08-06 lifecycle rename: researching→cart, rfq→quoting,
    // po_placed→ordered. Cart is the ready-to-buy stage; quoting sits beside
    // it (out to suppliers). Pure rename — no compensating events needed.
    const renamed = await engine.query(
      `UPDATE line_items SET status = CASE status
         WHEN 'researching' THEN 'cart'
         WHEN 'rfq'         THEN 'quoting'
         WHEN 'po_placed'   THEN 'ordered'
       END
       WHERE status IN ('researching','rfq','po_placed')
       RETURNING id`);
    await engine.query(`ALTER TABLE line_items DROP CONSTRAINT IF EXISTS line_items_status_check`);
    await engine.query(
      `ALTER TABLE line_items ADD CONSTRAINT line_items_status_check
       CHECK (status IN ('quoting','cart','ordered','delivered'))`);
    await engine.query(`ALTER TABLE line_items ALTER COLUMN status SET DEFAULT 'cart'`);
    console.log(`lifecycle rename: ${renamed.length} item(s) moved to quoting/cart/ordered vocab`);

    // ---- 3. Vendors from legacy vendor text; vendor_id backfill ----
    const extracted = await engine.query(
      `INSERT INTO vendors (user_id, name, source)
       SELECT DISTINCT ON (COALESCE(c.user_id::text, ''), lower(c.name)) c.user_id, c.name, 'manual'
       FROM (
         SELECT p.user_id, trim(li.vendor) AS name
         FROM line_items li JOIN projects p ON p.id = li.project_id
         WHERE COALESCE(trim(li.vendor), '') <> ''
         UNION
         SELECT p.user_id, trim(o.vendor)
         FROM line_item_options o JOIN projects p ON p.id = o.project_id
         WHERE COALESCE(trim(o.vendor), '') <> ''
       ) c
       WHERE NOT EXISTS (SELECT 1 FROM vendors v
                         WHERE v.user_id IS NOT DISTINCT FROM c.user_id
                           AND lower(v.name) = lower(c.name))
       ORDER BY COALESCE(c.user_id::text, ''), lower(c.name), c.name
       RETURNING id`);
    const linkedItems = await engine.query(
      `UPDATE line_items li SET vendor_id = v.id
       FROM projects p, vendors v
       WHERE p.id = li.project_id AND li.vendor_id IS NULL
         AND COALESCE(trim(li.vendor), '') <> ''
         AND v.user_id IS NOT DISTINCT FROM p.user_id
         AND lower(v.name) = lower(trim(li.vendor))
       RETURNING li.id`);
    const linkedOptions = await engine.query(
      `UPDATE line_item_options o SET vendor_id = v.id
       FROM projects p, vendors v
       WHERE p.id = o.project_id AND o.vendor_id IS NULL
         AND COALESCE(trim(o.vendor), '') <> ''
         AND v.user_id IS NOT DISTINCT FROM p.user_id
         AND lower(v.name) = lower(trim(o.vendor))
       RETURNING o.id`);
    console.log(`vendors extracted: ${extracted.length} new; linked ${linkedItems.length} line item(s), ${linkedOptions.length} option(s)`);
  }

  // ---- 4. Full schema.sql (tables no-op; policies drop+recreate) ----
  await engine.initSchema();
  console.log('schema applied');

  // ---- 5. Grants for every provisioned scoped role, incl. vendors ----
  const roles = await engine.query<{ pg_role: string }>(
    `SELECT pg_role FROM users WHERE pg_role IS NOT NULL`);
  for (const { pg_role } of roles) {
    // Role names come from our own provisioning regex; still, re-validate.
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(pg_role)) continue;
    await engine.query(`GRANT USAGE ON SCHEMA public TO ${pg_role}`);
    await engine.query(`GRANT SELECT ON users TO ${pg_role}`);
    await engine.query(
      `GRANT SELECT, INSERT, UPDATE ON projects, project_specs, line_items, order_events, line_item_options, vendors TO ${pg_role}`);
  }
  console.log(`grants refreshed for ${roles.length} role(s): ${roles.map(r => r.pg_role).join(', ')}`);
}
