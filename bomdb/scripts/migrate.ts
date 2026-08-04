// Apply the current schema.sql to the hosted database and refresh grants for
// every provisioned scoped role. Idempotent — safe to run after any schema
// change. Requires the MASTER connection (scoped roles have no DDL rights).
//   DATABASE_URL=<master> node scripts/migrate.ts
import { createEngine } from '../src/engine.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (master connection) is required');
  process.exit(1);
}

const engine = await createEngine();
await engine.initSchema();
console.log('schema applied');

const roles = await engine.query<{ pg_role: string }>(
  `SELECT pg_role FROM users WHERE pg_role IS NOT NULL`);
for (const { pg_role } of roles) {
  // Role names come from our own provisioning regex; still, re-validate.
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(pg_role)) continue;
  await engine.query(`GRANT USAGE ON SCHEMA public TO ${pg_role}`);
  await engine.query(`GRANT SELECT ON users TO ${pg_role}`);
  await engine.query(
    `GRANT SELECT, INSERT, UPDATE ON projects, project_specs, line_items, order_events, line_item_options TO ${pg_role}`);
}
console.log(`grants refreshed for ${roles.length} role(s): ${roles.map(r => r.pg_role).join(', ')}`);
await engine.close();
