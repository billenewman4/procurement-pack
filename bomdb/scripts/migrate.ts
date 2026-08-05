// Apply the current schema.sql to the hosted database and refresh grants for
// every provisioned scoped role. Idempotent — safe to run after any schema
// change. Requires the MASTER connection (scoped roles have no DDL rights).
//   DATABASE_URL=<master> node scripts/migrate.ts
// The migration body lives in migrate-lib.ts (tested by test/migrate.test.ts).
import { createEngine } from '../src/engine.ts';
import { migrate } from './migrate-lib.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (master connection) is required');
  process.exit(1);
}

const engine = await createEngine();
await migrate(engine);
await engine.close();
