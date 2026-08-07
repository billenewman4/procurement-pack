// Attach (or correct) the email on a users row. The email IS the ProcurePro
// invite whitelist: /auth/register only accepts addresses that already sit on
// a users row, so running this is how you invite someone.
// Admin tool: requires the MASTER connection (bomdb/.env holds it).
//   node --env-file=.env scripts/set-user-email.ts <user-name-or-role> <email>
//   (or: DATABASE_URL=<master> node scripts/set-user-email.ts <who> <email>)
import { createEngine } from '../src/engine.ts';

const [who, email] = process.argv.slice(2);
if (!who || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('usage: node --env-file=.env scripts/set-user-email.ts <user-name-or-role> <email>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (master connection) is required — run with --env-file=.env');
  process.exit(1);
}

const engine = await createEngine();
try {
  const updated = await engine.query<{ name: string; pg_role: string | null; email: string }>(
    `UPDATE users SET email = lower($2)
     WHERE pg_role = $1 OR name = $1
     RETURNING name, pg_role, email`,
    [who, email]);
  if (updated.length === 0) {
    console.error(`no user with name or pg_role "${who}"`);
    process.exit(1);
  }
  if (updated.length > 1) {
    console.warn(`warning: "${who}" matched ${updated.length} users — all now share this email? Fix manually.`);
  }
  for (const u of updated) {
    console.log(`"${u.name}" (role ${u.pg_role ?? 'none'}) → ${u.email} — this address can now register on ProcurePro.`);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unique|duplicate/i.test(msg)) {
    console.error(`email ${email} is already on another users row`);
    process.exit(1);
  }
  throw err;
} finally {
  await engine.close();
}
