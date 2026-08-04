// Provision a scoped hosted-mode user: their own Postgres role + users row.
// Run with the MASTER connection: DATABASE_URL=<master> node scripts/provision-user.ts <role> <name> <email>
// Prints the user's personal connection string — send it to them PRIVATELY.
// Roles get SELECT/INSERT/UPDATE only (no DELETE), and RLS scopes every row.
import { randomBytes } from 'node:crypto';
import { createEngine } from '../src/engine.ts';
import { connectionUrls } from './provision-lib.ts';

const [role, name, email] = process.argv.slice(2);
if (!role || !name || !email || !/^[a-z][a-z0-9_]{1,30}$/.test(role)) {
  console.error('usage: DATABASE_URL=<master> node scripts/provision-user.ts <role: [a-z][a-z0-9_]*> <name> <email>');
  process.exit(1);
}
const masterUrl = process.env.DATABASE_URL;
if (!masterUrl) {
  console.error('DATABASE_URL (master connection) is required');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const engine = await createEngine();

// Role names can't be parameterized; the regex above keeps this injection-safe.
await engine.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
await engine.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
await engine.query(`GRANT SELECT ON users TO ${role}`);
await engine.query(
  `GRANT SELECT, INSERT, UPDATE ON projects, project_specs, line_items, order_events, line_item_options TO ${role}`);
await engine.query(
  `INSERT INTO users (name, email, sharing, pg_role) VALUES ($1, $2, 'hosted', $3)
   ON CONFLICT (email) DO UPDATE SET pg_role = EXCLUDED.pg_role, name = EXCLUDED.name`,
  [name, email, role]);
await engine.close();

const { direct, pooler } = connectionUrls(masterUrl, role, password);
console.log(`Provisioned "${name}" <${email}> as role "${role}".`);
console.log(`Their connection strings (send PRIVATELY, never commit):`);
console.log(`  direct (IPv6 networks): ${direct}`);
if (pooler) {
  console.log(`  pooler (IPv4 — use for Cloud Run TOKEN_MAP and most home networks): ${pooler}`);
}
