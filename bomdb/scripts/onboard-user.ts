// One-command manual onboarding for the bomdb-remote hosted connector.
//
//   DATABASE_URL=<master> node scripts/onboard-user.ts <role> <name> <email>
//
// Does everything provision-user.ts does (scoped Postgres role + users row),
// then mints a connector token and prints:
//   1. the TOKEN_MAP entry to add (token -> pooler connection string)
//   2. the personal connector URL to send the user PRIVATELY
//
// After running, add the entry to TOKEN_MAP wherever it now lives (Secret
// Manager / env) and roll a new Cloud Run revision so it takes effect.
import { randomBytes } from 'node:crypto';
import { createEngine } from '../src/engine.ts';
import { connectionUrls } from './provision-lib.ts';

const SERVICE_URL = process.env.BOMDB_REMOTE_URL
  ?? 'https://bomdb-remote-cwqxqmx5wq-uc.a.run.app';

const [role, name, email] = process.argv.slice(2);
if (!role || !name || !email || !/^[a-z][a-z0-9_]{1,30}$/.test(role)) {
  console.error('usage: DATABASE_URL=<master> node scripts/onboard-user.ts <role: [a-z][a-z0-9_]*> <name> <email>');
  process.exit(1);
}
const masterUrl = process.env.DATABASE_URL;
if (!masterUrl) {
  console.error('DATABASE_URL (master connection) is required');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const token = randomBytes(24).toString('hex'); // same shape as `openssl rand -hex 24`
const engine = await createEngine();

// Role names can't be parameterized; the argv regex above keeps this injection-safe.
await engine.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
await engine.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
await engine.query(`GRANT SELECT ON users TO ${role}`);
await engine.query(
  `GRANT SELECT, INSERT, UPDATE ON projects, project_specs, line_items, order_events TO ${role}`);
await engine.query(
  `INSERT INTO users (name, email, sharing, pg_role) VALUES ($1, $2, 'hosted', $3)
   ON CONFLICT (email) DO UPDATE SET pg_role = EXCLUDED.pg_role, name = EXCLUDED.name`,
  [name, email, role]);
await engine.close();

const { pooler } = connectionUrls(masterUrl, role, password);
if (!pooler) {
  console.error('Could not derive the pooler connection string from DATABASE_URL — '
    + 'Cloud Run needs the pooler form (IPv4). Fix the master URL and re-run.');
  process.exit(1);
}

console.log(`Provisioned "${name}" <${email}> as role "${role}".\n`);
console.log('1) Add this entry to TOKEN_MAP (Secret Manager or env), then roll a new revision:\n');
console.log(`  "${token}": "${pooler}"\n`);
console.log('2) Send them PRIVATELY (this URL is their password):\n');
console.log(`  ${SERVICE_URL}/mcp/${token}\n`);
console.log('   claude.ai: Settings -> Connectors -> Add custom connector -> paste URL');
console.log(`   Claude Code: claude mcp add --transport http bomdb ${SERVICE_URL}/mcp/${token}`);
