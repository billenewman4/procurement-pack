// Wipe a hosted user's workspace back to brand-new — projects, specs, line
// items, and order events all go (users row and Postgres role stay, so their
// token/connector keep working and the next chat gets the new-user flow).
// Admin tool: requires the MASTER connection, which bypasses RLS.
//   DATABASE_URL=<master> node scripts/reset-user.ts <role>
import { createEngine } from '../src/engine.ts';

const [role] = process.argv.slice(2);
if (!role || !/^[a-z][a-z0-9_]{1,30}$/.test(role)) {
  console.error('usage: DATABASE_URL=<master> node scripts/reset-user.ts <role>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (master connection) is required');
  process.exit(1);
}

const engine = await createEngine();
const [user] = await engine.query<{ id: string; name: string }>(
  `SELECT id, name FROM users WHERE pg_role = $1`, [role]);
if (!user) {
  console.error(`no user with pg_role "${role}"`);
  await engine.close();
  process.exit(1);
}
// order_events / line_items / project_specs cascade from projects; one-off
// items, their events, and the vendor CRM are user-scoped and need their own
// deletes (vendors last — line_items.vendor_id references them).
const deleted = await engine.query<{ id: string }>(
  `DELETE FROM projects WHERE user_id = $1 RETURNING id`, [user.id]);
const oneOffEvents = await engine.query<{ id: string }>(
  `DELETE FROM order_events WHERE project_id IS NULL AND user_id = $1 RETURNING id`, [user.id]);
const oneOffs = await engine.query<{ id: string }>(
  `DELETE FROM line_items WHERE project_id IS NULL AND user_id = $1 RETURNING id`, [user.id]);
const vendors = await engine.query<{ id: string }>(
  `DELETE FROM vendors WHERE user_id = $1 RETURNING id`, [user.id]);
await engine.close();
console.log(`Reset "${user.name}" (${role}): ${deleted.length} project(s), ${oneOffs.length} one-off item(s) (+${oneOffEvents.length} event(s)), ${vendors.length} vendor(s) deleted. Their next chat is a fresh start.`);
