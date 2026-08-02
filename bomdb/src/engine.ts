import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
  'utf8',
);

export interface Engine {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  initSchema(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Handlers pass optional op params straight through, so omitted values arrive
 * as undefined. postgres.js hard-rejects undefined (UNDEFINED_VALUE) while
 * PGLite silently coerces it — normalize to null in BOTH engines so behavior
 * stays identical across local and hosted.
 */
function nullifyUndefined(params: unknown[]): unknown[] {
  return params.map(v => (v === undefined ? null : v));
}

function pgliteEngine(db: PGlite): Engine {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, nullifyUndefined(params));
      return res.rows as T[];
    },
    async initSchema() {
      await db.exec(SCHEMA);
    },
    async close() {
      await db.close();
    },
  };
}

/**
 * DATABASE_URL always wins. Otherwise PGLite in BOMDB_DATA_DIR
 * (default ~/.bomdb/data) — a real Postgres, no server.
 */
export async function createEngine(): Promise<Engine> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import('postgres')).default;
    const sql = postgres(url, { onnotice: () => {} });
    return {
      async query<T>(q: string, params: unknown[] = []) {
        // postgres.js types unsafe() params as its own ParameterOrJSON[]; our
        // unknown[] is what actually flows through, so narrow with a cast.
        return (await sql.unsafe(q, nullifyUndefined(params) as never[])) as T[];
      },
      async initSchema() {
        await sql.unsafe(SCHEMA).simple();
      },
      async close() {
        await sql.end();
      },
    };
  }
  const dataDir =
    process.env.BOMDB_DATA_DIR ?? join(homedir(), '.bomdb', 'data');
  // PGLite mkdirs the leaf but not parents — create the full path up front.
  mkdirSync(dataDir, { recursive: true });
  return pgliteEngine(new PGlite(dataDir));
}

/**
 * Startup schema init that works for BOTH connection kinds: the owner/local
 * connection applies the schema (idempotent DDL); a scoped hosted user has no
 * DDL permission, so the attempt fails — that's fine as long as the schema
 * already exists (the admin manages it). Probe before swallowing the error so
 * a genuinely broken connection still fails loudly.
 */
export async function ensureSchema(engine: Engine): Promise<void> {
  try {
    await engine.initSchema();
  } catch (err) {
    try {
      await engine.query('SELECT 1 FROM projects LIMIT 0');
    } catch {
      throw err;
    }
  }
}

/** In-memory PGLite with schema applied — for tests only. */
export async function createTestEngine(): Promise<Engine> {
  const engine = pgliteEngine(new PGlite());
  await engine.initSchema();
  return engine;
}
