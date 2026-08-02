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

function pgliteEngine(db: PGlite): Engine {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
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
        return (await sql.unsafe(q, params as never[])) as T[];
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

/** In-memory PGLite with schema applied — for tests only. */
export async function createTestEngine(): Promise<Engine> {
  const engine = pgliteEngine(new PGlite());
  await engine.initSchema();
  return engine;
}
