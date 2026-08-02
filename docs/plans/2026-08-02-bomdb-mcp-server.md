# bomdb MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A small MCP server (`bomdb`) that gives Claude read/write access to the BOM database defined in SCHEMA.md — PGLite locally by default, hosted Postgres when `DATABASE_URL` is set.

**Architecture:** Contract-first, stolen from gbrain: a single operations registry (`operations.ts`) is the source of truth; MCP tool definitions are generated from it (`tool-defs.ts`, lifted nearly verbatim from gbrain). One tiny engine adapter wraps PGLite and postgres.js behind the same `query()` interface. The MCP server is stdio transport via the official SDK. No CLI, no HTTP, no RLS in v1 (week 1 = Eshan + Bill self-use).

**Tech Stack:** TypeScript run natively by Node ≥23.6 (type stripping — no build step, no Bun), `@modelcontextprotocol/sdk`, `@electric-sql/pglite`, `postgres` (postgres.js), `node:test` for tests.

**Repo layout (all inside procurement-pack):**

```
bomdb/
  package.json
  src/
    schema.sql        # from locked SCHEMA.md
    engine.ts         # PGLite ↔ postgres adapter + initSchema
    status.ts         # forward-only transition guard
    operations.ts     # the ops registry (10 ops) — single source of truth
    tool-defs.ts      # registry → MCP tool JSON schemas (lifted from gbrain)
    server.ts         # stdio MCP entry point
  test/
    engine.test.ts
    status.test.ts
    operations.test.ts
    export-import.test.ts
    tool-defs.test.ts
```

**Rules that apply to every task:**
- Work on branch `bomdb-v1` (Task 1 creates it). Commit after every task.
- TypeScript must be *erasable* (no enums, no namespaces, `import type` for types) — Node's native type stripping requires it. Use string-literal unions instead of enums.
- All imports of local files use explicit `.ts` extensions (Node native TS requirement).
- Tests use in-memory PGLite (`new PGlite()` with no datadir) — no server, instant, throwaway.
- Constraint checks live in the DB (CHECK constraints) AND handlers return clean `{ error }` objects, never throw raw SQL errors at the model.

---

### Task 1: Scaffold the package

**Files:**
- Create: `bomdb/package.json`
- Create: `bomdb/.gitignore`

**Step 1: Branch**

```bash
cd /Users/eshantarneja/Documents/Git/procurement-pack
git checkout -b bomdb-v1
```

**Step 2: Write package.json**

```json
{
  "name": "bomdb",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "MCP server for the procurement-pack BOM store (PGLite local / Postgres hosted)",
  "scripts": {
    "test": "node --test test/",
    "start": "node src/server.ts"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.2.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "postgres": "^3.4.0"
  }
}
```

**Step 3: Write .gitignore**

```
node_modules/
```

**Step 4: Install and verify Node version**

```bash
cd bomdb && npm install
node --version   # expect ≥ 23.6 (native TS). Machine has 23.9.0.
```

Expected: install succeeds, no errors.

**Step 5: Commit**

```bash
git add bomdb/package.json bomdb/.gitignore bomdb/package-lock.json
git commit -m "feat(bomdb): scaffold package"
```

---

### Task 2: Schema + engine adapter

**Files:**
- Create: `bomdb/src/schema.sql`
- Create: `bomdb/src/engine.ts`
- Test: `bomdb/test/engine.test.ts`

**Step 1: Write schema.sql** — this is the locked SCHEMA.md, verbatim in SQL. Idempotent (`IF NOT EXISTS`) instead of a migration runner (YAGNI for v1; revisit when the schema first changes).

```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  sharing text NOT NULL DEFAULT 'hosted'
    CHECK (sharing IN ('local','hosted','community')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  spec text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);

CREATE TABLE IF NOT EXISTS line_items (
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
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','search','email')),
  ordered_at timestamptz,
  eta date,
  notes text,
  chosen_because text,
  outcome text CHECK (outcome IN ('worked','failed','returned')),
  outcome_notes text
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid REFERENCES line_items(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  order_number text,
  event text NOT NULL
    CHECK (event IN ('confirmed','shipped','delivered','backordered','issue')),
  event_at timestamptz NOT NULL,
  tracking_url text,
  email_ref text,
  raw_summary text
);
```

Note `UNIQUE (project_id, category)` on specs — upsert_spec needs a conflict target, and one freeform blob per category is the locked design.

**Step 2: Write the failing test**

```ts
// bomdb/test/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine } from '../src/engine.ts';

test('initSchema creates all five tables', async () => {
  const engine = await createTestEngine();
  const rows = await engine.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const names = rows.map(r => r.table_name);
  for (const t of ['line_items', 'order_events', 'project_specs', 'projects', 'users']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  await engine.close();
});

test('initSchema is idempotent', async () => {
  const engine = await createTestEngine();
  await engine.initSchema(); // second run must not throw
  await engine.close();
});
```

**Step 3: Run test to verify it fails**

```bash
cd bomdb && npm test
```
Expected: FAIL — cannot find module `../src/engine.ts`.

**Step 4: Write engine.ts**

```ts
// bomdb/src/engine.ts
import { readFileSync } from 'node:fs';
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
    async query(sql, params = []) {
      const res = await db.query(sql, params as unknown[]);
      return res.rows as never[];
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
 * DATABASE_URL always wins (gbrain config rule). Otherwise PGLite in
 * BOMDB_DATA_DIR (default ~/.bomdb/data) — a real Postgres, no server.
 */
export async function createEngine(): Promise<Engine> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import('postgres')).default;
    const sql = postgres(url, { onnotice: () => {} });
    return {
      async query(q, params = []) {
        return (await sql.unsafe(q, params as never[])) as never[];
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
    process.env.BOMDB_DATA_DIR ?? join(process.env.HOME ?? '.', '.bomdb', 'data');
  return pgliteEngine(new PGlite(dataDir));
}

/** In-memory PGLite with schema applied — for tests only. */
export async function createTestEngine(): Promise<Engine> {
  const engine = pgliteEngine(new PGlite());
  await engine.initSchema();
  return engine;
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test
```
Expected: 2 pass.

**Step 6: Commit**

```bash
git add bomdb/src/schema.sql bomdb/src/engine.ts bomdb/test/engine.test.ts
git commit -m "feat(bomdb): schema + PGLite/Postgres engine adapter"
```

---

### Task 3: Status transition guard

The locked rule: forward-only automatic; backward moves and moves to `issue` need explicit confirmation. This is pure logic — isolate it.

**Files:**
- Create: `bomdb/src/status.ts`
- Test: `bomdb/test/status.test.ts`

**Step 1: Write the failing test**

```ts
// bomdb/test/status.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForwardMove, STATUSES } from '../src/status.ts';

test('forward moves are allowed', () => {
  assert.equal(isForwardMove('needed', 'researching'), true);
  assert.equal(isForwardMove('needed', 'ordered'), true); // skipping is fine
  assert.equal(isForwardMove('ordered', 'shipped'), true);
  assert.equal(isForwardMove('shipped', 'delivered'), true);
});

test('backward moves are not forward', () => {
  assert.equal(isForwardMove('delivered', 'ordered'), false);
  assert.equal(isForwardMove('shipped', 'researching'), false);
  assert.equal(isForwardMove('ordered', 'ordered'), false); // no-op isn't forward
});

test('issue is never a forward move', () => {
  assert.equal(isForwardMove('needed', 'issue'), false);
  assert.equal(isForwardMove('delivered', 'issue'), false);
});

test('moving out of issue is never automatic', () => {
  assert.equal(isForwardMove('issue', 'ordered'), false);
});

test('STATUSES exports the canonical order', () => {
  assert.deepEqual(STATUSES, ['needed', 'researching', 'ordered', 'shipped', 'delivered', 'issue']);
});
```

**Step 2: Run to verify FAIL** (`npm test` — module not found)

**Step 3: Write status.ts**

```ts
// bomdb/src/status.ts
export const STATUSES = ['needed', 'researching', 'ordered', 'shipped', 'delivered', 'issue'] as const;
export type Status = (typeof STATUSES)[number];

const FORWARD_ORDER: readonly string[] = ['needed', 'researching', 'ordered', 'shipped', 'delivered'];

/** True only for a strictly-forward move along the lifecycle. `issue` (either
 *  direction) is never forward — it always requires user confirmation. */
export function isForwardMove(from: string, to: string): boolean {
  const a = FORWARD_ORDER.indexOf(from);
  const b = FORWARD_ORDER.indexOf(to);
  return a >= 0 && b >= 0 && b > a;
}

/** Map an order_events.event to the line-item status it implies, or null if
 *  it must never auto-apply (backordered/issue → flag, don't move). */
export function eventToStatus(event: string): Status | null {
  switch (event) {
    case 'confirmed': return 'ordered';
    case 'shipped': return 'shipped';
    case 'delivered': return 'delivered';
    default: return null;
  }
}
```

**Step 4: Run tests — expect all pass.**

**Step 5: Commit** — `git commit -m "feat(bomdb): forward-only status transition guard"`

---

### Task 4: Operations registry — projects & specs

**Files:**
- Create: `bomdb/src/operations.ts`
- Test: `bomdb/test/operations.test.ts`

**Step 1: Write the failing tests**

```ts
// bomdb/test/operations.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

let engine: Engine;
before(async () => { engine = await createTestEngine(); });
after(async () => { await engine.close(); });

test('create_project returns the row; list_projects sees it', async () => {
  const created = await runOp(engine, 'create_project', { name: 'plant-waterer-v1' }) as { id: string; name: string };
  assert.equal(created.name, 'plant-waterer-v1');
  assert.ok(created.id);
  const list = await runOp(engine, 'list_projects', {}) as { id: string }[];
  assert.equal(list.length, 1);
});

test('upsert_spec inserts then replaces per (project, category)', async () => {
  const p = await runOp(engine, 'create_project', { name: 'spec-test' }) as { id: string };
  await runOp(engine, 'upsert_spec', { project_id: p.id, category: 'power', spec: '12V rail, 3A max' });
  await runOp(engine, 'upsert_spec', { project_id: p.id, category: 'power', spec: '12V rail, 5A max' });
  const ctx = await runOp(engine, 'get_project_context', { project_id: p.id }) as { specs: { category: string; spec: string }[] };
  const power = ctx.specs.filter(s => s.category === 'power');
  assert.equal(power.length, 1);
  assert.equal(power[0].spec, '12V rail, 5A max');
});

test('unknown op returns a clean error', async () => {
  const res = await runOp(engine, 'nonsense_op', {}) as { error: string };
  assert.match(res.error, /unknown operation/i);
});

test('missing required param returns a clean error, not a throw', async () => {
  const res = await runOp(engine, 'create_project', {}) as { error: string };
  assert.match(res.error, /name/);
});
```

**Step 2: Run — FAIL (module not found).**

**Step 3: Write operations.ts** — registry types + dispatch + first three ops:

```ts
// bomdb/src/operations.ts
import type { Engine } from './engine.ts';
import { isForwardMove, eventToStatus, STATUSES } from './status.ts';

export interface ParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  enum?: readonly string[];
  items?: ParamDef;
}

export interface Operation {
  name: string;
  description: string;
  params: Record<string, ParamDef>;
  handler: (engine: Engine, params: Record<string, unknown>) => Promise<unknown>;
}

export const operations: Operation[] = [
  {
    name: 'create_project',
    description: 'Create a new hardware project. Returns the project row.',
    params: { name: { type: 'string', description: 'Project name, e.g. "plant-waterer-v1"', required: true } },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `INSERT INTO projects (name) VALUES ($1) RETURNING *`, [p.name]);
      return rows[0];
    },
  },
  {
    name: 'list_projects',
    description: 'List all projects with line-item counts.',
    params: {},
    handler: (engine) => engine.query(
      `SELECT p.*, count(li.id)::int AS line_item_count
       FROM projects p LEFT JOIN line_items li ON li.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at`),
  },
  {
    name: 'upsert_spec',
    description: 'Set a project spec for a category (power, connectors, mechanical, constraints, ...). Replaces any existing spec for that category.',
    params: {
      project_id: { type: 'string', required: true },
      category: { type: 'string', description: 'e.g. power, connectors, mechanical, constraints', required: true },
      spec: { type: 'string', description: 'Freeform spec text', required: true },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `INSERT INTO project_specs (project_id, category, spec) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, category)
         DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
         RETURNING *`, [p.project_id, p.category, p.spec]);
      return rows[0];
    },
  },
  {
    name: 'get_project_context',
    description: 'Everything part-search loads before searching: the project, its specs, and its full BOM. Call this FIRST when working on a project.',
    params: { project_id: { type: 'string', required: true } },
    handler: async (engine, p) => {
      const [project] = await engine.query(`SELECT * FROM projects WHERE id = $1`, [p.project_id]);
      if (!project) return { error: `project ${p.project_id} not found` };
      const specs = await engine.query(
        `SELECT category, spec, updated_at FROM project_specs WHERE project_id = $1 ORDER BY category`, [p.project_id]);
      const line_items = await engine.query(
        `SELECT * FROM line_items WHERE project_id = $1 ORDER BY status, description`, [p.project_id]);
      return { project, specs, line_items };
    },
  },
];

/** Validate params against the op's declared schema; dispatch; never throw. */
export async function runOp(
  engine: Engine, name: string, params: Record<string, unknown>,
): Promise<unknown> {
  const op = operations.find(o => o.name === name);
  if (!op) return { error: `unknown operation: ${name}` };
  for (const [key, def] of Object.entries(op.params)) {
    if (def.required && (params[key] === undefined || params[key] === null || params[key] === '')) {
      return { error: `missing required param: ${key}` };
    }
  }
  try {
    return await op.handler(engine, params);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Step 4: Run tests — expect pass.**

**Step 5: Commit** — `git commit -m "feat(bomdb): ops registry + project/spec operations"`

---

### Task 5: Line-item operations (with the transition guard)

**Files:**
- Modify: `bomdb/src/operations.ts` (append to `operations` array)
- Test: append to `bomdb/test/operations.test.ts`

**Step 1: Write the failing tests**

```ts
test('upsert_line_item creates with defaults; update by id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'li-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'step-down converter 12V→5V 3A',
    vendor: 'Amazon', qty: 2, unit_price: 11.99, source: 'search',
    chosen_because: '12V rail, 400mA < 3A budget',
  }) as { id: string; status: string };
  assert.equal(li.status, 'needed');
  const updated = await runOp(engine, 'upsert_line_item', {
    id: li.id, project_id: p.id, description: 'step-down converter 12V→5V 3A', qty: 3,
  }) as { qty: number };
  assert.equal(updated.qty, 3);
});

test('update_status: forward auto, backward refused without confirm', async () => {
  const p = await runOp(engine, 'create_project', { name: 'status-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'pump', status: 'ordered',
  }) as { id: string };
  const fwd = await runOp(engine, 'update_status', { line_item_id: li.id, status: 'shipped' }) as { status: string };
  assert.equal(fwd.status, 'shipped');
  const back = await runOp(engine, 'update_status', { line_item_id: li.id, status: 'ordered' }) as { error: string };
  assert.match(back.error, /confirm/i);
  const confirmed = await runOp(engine, 'update_status', {
    line_item_id: li.id, status: 'ordered', confirmed: true,
  }) as { status: string };
  assert.equal(confirmed.status, 'ordered');
});

test('set_outcome records worked/failed with notes', async () => {
  const p = await runOp(engine, 'create_project', { name: 'outcome-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', { project_id: p.id, description: 'buck converter' }) as { id: string };
  const res = await runOp(engine, 'set_outcome', {
    line_item_id: li.id, outcome: 'worked', outcome_notes: 'browned out under pump inrush until cap added',
  }) as { outcome: string };
  assert.equal(res.outcome, 'worked');
});
```

**Step 2: Run — FAIL (ops don't exist).**

**Step 3: Append three ops to the registry**

```ts
  {
    name: 'upsert_line_item',
    description: 'Add a part to the BOM, or update it by id. New items default to status "needed". Fill chosen_because with which specs the part satisfies.',
    params: {
      id: { type: 'string', description: 'Omit to create' },
      project_id: { type: 'string', required: true },
      description: { type: 'string', required: true },
      part_number: { type: 'string' }, vendor: { type: 'string' },
      product_url: { type: 'string' }, qty: { type: 'number' },
      unit_price: { type: 'number' },
      status: { type: 'string', enum: STATUSES },
      source: { type: 'string', enum: ['manual', 'search', 'email'] },
      ordered_at: { type: 'string' }, eta: { type: 'string' },
      notes: { type: 'string' }, chosen_because: { type: 'string' },
    },
    handler: async (engine, p) => {
      if (p.id) {
        const rows = await engine.query(
          `UPDATE line_items SET
             description = COALESCE($2, description), part_number = COALESCE($3, part_number),
             vendor = COALESCE($4, vendor), product_url = COALESCE($5, product_url),
             qty = COALESCE($6, qty), unit_price = COALESCE($7, unit_price),
             source = COALESCE($8, source), ordered_at = COALESCE($9, ordered_at),
             eta = COALESCE($10, eta), notes = COALESCE($11, notes),
             chosen_because = COALESCE($12, chosen_because)
           WHERE id = $1 RETURNING *`,
          [p.id, p.description, p.part_number, p.vendor, p.product_url, p.qty,
           p.unit_price, p.source, p.ordered_at, p.eta, p.notes, p.chosen_because]);
        return rows[0] ?? { error: `line item ${p.id} not found` };
      }
      const rows = await engine.query(
        `INSERT INTO line_items
           (project_id, description, part_number, vendor, product_url, qty,
            unit_price, status, source, ordered_at, eta, notes, chosen_because)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7,COALESCE($8,'needed'),COALESCE($9,'manual'),$10,$11,$12,$13)
         RETURNING *`,
        [p.project_id, p.description, p.part_number, p.vendor, p.product_url, p.qty,
         p.unit_price, p.status, p.source, p.ordered_at, p.eta, p.notes, p.chosen_because]);
      return rows[0];
    },
  },
  {
    name: 'update_status',
    description: 'Move a line item through its lifecycle. Forward moves apply immediately. Backward moves and moves to/from "issue" are refused unless confirmed=true — ask the user before confirming.',
    params: {
      line_item_id: { type: 'string', required: true },
      status: { type: 'string', enum: STATUSES, required: true },
      confirmed: { type: 'boolean', description: 'Set true ONLY after the user explicitly approves a non-forward move' },
    },
    handler: async (engine, p) => {
      const [current] = await engine.query<{ status: string }>(
        `SELECT status FROM line_items WHERE id = $1`, [p.line_item_id]);
      if (!current) return { error: `line item ${p.line_item_id} not found` };
      if (!isForwardMove(current.status, p.status as string) && p.confirmed !== true) {
        return { error: `"${current.status}" → "${p.status}" is not a forward move; requires user confirmation (confirmed=true)` };
      }
      const rows = await engine.query(
        `UPDATE line_items SET status = $2,
           ordered_at = CASE WHEN $2 = 'ordered' AND ordered_at IS NULL THEN now() ELSE ordered_at END
         WHERE id = $1 RETURNING *`, [p.line_item_id, p.status]);
      return rows[0];
    },
  },
  {
    name: 'set_outcome',
    description: 'Record how a part worked out (worked/failed/returned) and why. Fill this whenever the user reports a part succeeded, failed, or was returned — it is the most valuable data in the system.',
    params: {
      line_item_id: { type: 'string', required: true },
      outcome: { type: 'string', enum: ['worked', 'failed', 'returned'], required: true },
      outcome_notes: { type: 'string', description: 'Why — e.g. "browned out under pump inrush"' },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `UPDATE line_items SET outcome = $2, outcome_notes = COALESCE($3, outcome_notes)
         WHERE id = $1 RETURNING *`, [p.line_item_id, p.outcome, p.outcome_notes]);
      return rows[0] ?? { error: `line item ${p.line_item_id} not found` };
    },
  },
```

**Step 4: Run tests — expect pass.**

**Step 5: Commit** — `git commit -m "feat(bomdb): line-item ops with forward-only status guard"`

---### Task 6: Order events + stale orders

**Files:**
- Modify: `bomdb/src/operations.ts` (append)
- Test: append to `bomdb/test/operations.test.ts`

**Step 1: Write the failing tests**

```ts
test('record_order_event auto-advances matched item forward only', async () => {
  const p = await runOp(engine, 'create_project', { name: 'event-test' }) as { id: string };
  const li = await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'pump', status: 'ordered',
  }) as { id: string };
  const ev = await runOp(engine, 'record_order_event', {
    project_id: p.id, line_item_id: li.id, vendor: 'Amazon', order_number: '112-4477',
    event: 'shipped', event_at: '2026-08-02T14:00:00Z',
    raw_summary: 'Amazon order 112-4477 shipped, ETA Aug 6',
  }) as { event: string; line_item_status: string };
  assert.equal(ev.line_item_status, 'shipped');
  // a backordered event must NOT move the item backward — only flag
  const back = await runOp(engine, 'record_order_event', {
    project_id: p.id, line_item_id: li.id, vendor: 'Amazon', order_number: '112-4477',
    event: 'backordered', event_at: '2026-08-03T14:00:00Z', raw_summary: 'backordered',
  }) as { line_item_status: string; flag?: string };
  assert.equal(back.line_item_status, 'shipped'); // unchanged
  assert.ok(back.flag, 'anomaly should be flagged for the user');
});

test('unmatched events are kept with null line_item_id', async () => {
  const p = await runOp(engine, 'create_project', { name: 'unmatched-test' }) as { id: string };
  const ev = await runOp(engine, 'record_order_event', {
    project_id: p.id, vendor: 'McMaster-Carr', order_number: '9999',
    event: 'confirmed', event_at: '2026-08-02T15:00:00Z', raw_summary: 'order 9999 confirmed',
  }) as { line_item_id: string | null };
  assert.equal(ev.line_item_id, null);
});

test('stale_orders finds ordered items with no recent event', async () => {
  const p = await runOp(engine, 'create_project', { name: 'stale-test' }) as { id: string };
  await runOp(engine, 'upsert_line_item', {
    project_id: p.id, description: 'old order', status: 'ordered',
    ordered_at: '2026-07-01T00:00:00Z',
  });
  const stale = await runOp(engine, 'stale_orders', { days: 7 }) as { description: string }[];
  assert.equal(stale.length, 1);
  assert.equal(stale[0].description, 'old order');
});
```

**Step 2: Run — FAIL.**

**Step 3: Append two ops**

```ts
  {
    name: 'record_order_event',
    description: 'Append an order lifecycle event from an email (gmail-orders emits these). Auto-advances the matched line item when the event implies a forward move; never moves backward — anomalies come back flagged for the user. Unmatched events (no line_item_id) are kept for manual reconciliation.',
    params: {
      project_id: { type: 'string', required: true },
      line_item_id: { type: 'string', description: 'Omit if unmatched' },
      vendor: { type: 'string', required: true },
      order_number: { type: 'string' },
      event: { type: 'string', enum: ['confirmed', 'shipped', 'delivered', 'backordered', 'issue'], required: true },
      event_at: { type: 'string', description: 'ISO timestamp from the email', required: true },
      tracking_url: { type: 'string' },
      email_ref: { type: 'string', description: 'Gmail message id' },
      raw_summary: { type: 'string', description: 'One line. Never full bodies.', required: true },
    },
    handler: async (engine, p) => {
      const [ev] = await engine.query(
        `INSERT INTO order_events (line_item_id, project_id, vendor, order_number, event, event_at, tracking_url, email_ref, raw_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [p.line_item_id ?? null, p.project_id, p.vendor, p.order_number ?? null,
         p.event, p.event_at, p.tracking_url ?? null, p.email_ref ?? null, p.raw_summary]);
      let line_item_status: string | null = null;
      let flag: string | undefined;
      if (p.line_item_id) {
        const [li] = await engine.query<{ status: string }>(
          `SELECT status FROM line_items WHERE id = $1`, [p.line_item_id]);
        if (li) {
          const implied = eventToStatus(p.event as string);
          if (implied && isForwardMove(li.status, implied)) {
            const [updated] = await engine.query<{ status: string }>(
              `UPDATE line_items SET status = $2 WHERE id = $1 RETURNING status`,
              [p.line_item_id, implied]);
            line_item_status = updated.status;
          } else {
            line_item_status = li.status;
            if (implied !== li.status) {
              flag = `event "${p.event}" does not forward-advance item in status "${li.status}" — surface to the user`;
            }
          }
        }
      }
      return { ...(ev as object), line_item_status, ...(flag ? { flag } : {}) };
    },
  },
  {
    name: 'stale_orders',
    description: 'Line items stuck in "ordered" with no order event in the last N days (default 7) — candidates for a vendor nudge.',
    params: {
      project_id: { type: 'string', description: 'Omit for all projects' },
      days: { type: 'number' },
    },
    handler: (engine, p) => engine.query(
      `SELECT li.*, p.name AS project_name,
              (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id) AS last_event_at
       FROM line_items li JOIN projects p ON p.id = li.project_id
       WHERE li.status = 'ordered'
         AND ($1::uuid IS NULL OR li.project_id = $1)
         AND COALESCE(
               (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id),
               li.ordered_at, now() - interval '100 years')
             < now() - make_interval(days => COALESCE($2::int, 7))
       ORDER BY li.ordered_at`,
      [p.project_id ?? null, p.days ?? null]),
  },
```

**Step 4: Run tests — expect pass.**

**Step 5: Commit** — `git commit -m "feat(bomdb): order events with anomaly flagging + stale orders"`

---

### Task 7: JSON export/import (Bill's bom.json shape)

The store protocol (store/README.md) is the contract: both backends hold identical shapes, migration is mechanical. Import must remap Bill's short string ids ("p1", "li1") to uuids while preserving line_item ↔ order_event links.

**Files:**
- Modify: `bomdb/src/operations.ts` (append)
- Test: `bomdb/test/export-import.test.ts`

**Step 1: Write the failing test** — use the exact example from store/README.md as the fixture:

```ts
// bomdb/test/export-import.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine } from '../src/engine.ts';
import { runOp } from '../src/operations.ts';

const BOM_JSON = {
  project: { id: 'p1', name: 'arduino-dogfood', created_at: '2026-07-31' },
  specs: [
    { id: 's1', category: 'power', spec: '12V rail, max 3A; barrel jack in', updated_at: '2026-07-31' },
  ],
  line_items: [
    { id: 'li1', description: 'step-down converter 12V→5V 3A', part_number: null,
      vendor: 'Amazon', product_url: null, qty: 2, unit_price: 11.99, status: 'ordered',
      source: 'search', ordered_at: '2026-07-31', eta: '2026-08-02', notes: null },
  ],
  order_events: [
    { id: 'oe1', line_item_id: 'li1', vendor: 'Amazon', order_number: '112-4477',
      event: 'confirmed', event_at: '2026-07-31T18:04:00Z', tracking_url: null,
      email_ref: null, raw_summary: 'Amazon order 112-4477 confirmed' },
  ],
  last_email_sync: '2026-07-31T18:00:00Z',
};

test('import_json → export_json round-trips Bill\'s bom.json shape', async () => {
  const engine = await createTestEngine();
  const imported = await runOp(engine, 'import_json', { bom: BOM_JSON }) as { project_id: string };
  assert.ok(imported.project_id);
  const out = await runOp(engine, 'export_json', { project_id: imported.project_id }) as typeof BOM_JSON;
  assert.equal(out.project.name, 'arduino-dogfood');
  assert.equal(out.specs.length, 1);
  assert.equal(out.line_items.length, 1);
  assert.equal(out.line_items[0].unit_price, 11.99);
  assert.equal(out.order_events.length, 1);
  // the link survived the id remap
  assert.equal(out.order_events[0].line_item_id, out.line_items[0].id);
  assert.equal(out.last_email_sync, '2026-07-31T18:04:00.000Z'); // derived: max(event_at)
  await engine.close();
});
```

**Step 2: Run — FAIL.**

**Step 3: Append the two ops**

```ts
  {
    name: 'export_json',
    description: 'Export a project in the bom.json interchange shape (store/README.md). last_email_sync is derived from max(order_events.event_at).',
    params: { project_id: { type: 'string', required: true } },
    handler: async (engine, p) => {
      const [project] = await engine.query(`SELECT * FROM projects WHERE id = $1`, [p.project_id]);
      if (!project) return { error: `project ${p.project_id} not found` };
      const specs = await engine.query(`SELECT * FROM project_specs WHERE project_id = $1 ORDER BY category`, [p.project_id]);
      const line_items = await engine.query(`SELECT * FROM line_items WHERE project_id = $1`, [p.project_id]);
      const order_events = await engine.query(`SELECT * FROM order_events WHERE project_id = $1 ORDER BY event_at`, [p.project_id]);
      const [sync] = await engine.query<{ max: string | null }>(
        `SELECT max(event_at) AS max FROM order_events WHERE project_id = $1`, [p.project_id]);
      return { project, specs, line_items, order_events, last_email_sync: sync?.max ?? null };
    },
  },
  {
    name: 'import_json',
    description: 'Import a bom.json (store/README.md shape) as a new project. Short ids are remapped to uuids; line_item↔order_event links are preserved.',
    params: { bom: { type: 'object', description: 'Parsed bom.json contents', required: true } },
    handler: async (engine, p) => {
      const bom = p.bom as {
        project: { name: string };
        specs?: { category: string; spec: string }[];
        line_items?: Record<string, unknown>[];
        order_events?: Record<string, unknown>[];
      };
      const [project] = await engine.query<{ id: string }>(
        `INSERT INTO projects (name) VALUES ($1) RETURNING id`, [bom.project.name]);
      for (const s of bom.specs ?? []) {
        await engine.query(
          `INSERT INTO project_specs (project_id, category, spec) VALUES ($1,$2,$3)
           ON CONFLICT (project_id, category) DO UPDATE SET spec = EXCLUDED.spec`,
          [project.id, s.category, s.spec]);
      }
      const idMap = new Map<string, string>();
      for (const li of bom.line_items ?? []) {
        const [row] = await engine.query<{ id: string }>(
          `INSERT INTO line_items (project_id, description, part_number, vendor, product_url, qty, unit_price, status, source, ordered_at, eta, notes)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7,COALESCE($8,'needed'),COALESCE($9,'manual'),$10,$11,$12) RETURNING id`,
          [project.id, li.description, li.part_number ?? null, li.vendor ?? null,
           li.product_url ?? null, li.qty ?? null, li.unit_price ?? null,
           li.status ?? null, li.source ?? null, li.ordered_at ?? null,
           li.eta ?? null, li.notes ?? null]);
        if (typeof li.id === 'string') idMap.set(li.id, row.id);
      }
      for (const oe of bom.order_events ?? []) {
        await engine.query(
          `INSERT INTO order_events (line_item_id, project_id, vendor, order_number, event, event_at, tracking_url, email_ref, raw_summary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [typeof oe.line_item_id === 'string' ? idMap.get(oe.line_item_id) ?? null : null,
           project.id, oe.vendor, oe.order_number ?? null, oe.event, oe.event_at,
           oe.tracking_url ?? null, oe.email_ref ?? null, oe.raw_summary ?? null]);
      }
      return { project_id: project.id, line_items_imported: (bom.line_items ?? []).length };
    },
  },
```

**Step 4: Run tests — expect pass.** (Watch the `last_email_sync` assertion — PGLite returns timestamps as Date objects; if the test fails on format, coerce with `new Date(...).toISOString()` in the export handler and update the assertion accordingly. Handle it in the export op, not the test, so MCP output is always ISO strings.)

**Step 5: Commit** — `git commit -m "feat(bomdb): bom.json export/import with id remapping"`

---

### Task 8: MCP tool-defs + server entry

**Files:**
- Create: `bomdb/src/tool-defs.ts` (lifted from gbrain `src/mcp/tool-defs.ts`, adapted to our ParamDef)
- Create: `bomdb/src/server.ts`
- Test: `bomdb/test/tool-defs.test.ts`

**Step 1: Write the failing test**

```ts
// bomdb/test/tool-defs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDefs } from '../src/tool-defs.ts';
import { operations } from '../src/operations.ts';

test('every op becomes a valid MCP tool def', () => {
  const defs = buildToolDefs(operations);
  assert.equal(defs.length, operations.length);
  for (const d of defs) {
    assert.ok(d.name && d.description);
    assert.equal(d.inputSchema.type, 'object');
  }
});

test('required params land in the required array', () => {
  const defs = buildToolDefs(operations);
  const create = defs.find(d => d.name === 'create_project')!;
  assert.deepEqual(create.inputSchema.required, ['name']);
});

test('enums survive the mapping', () => {
  const defs = buildToolDefs(operations);
  const status = defs.find(d => d.name === 'update_status')!;
  const prop = status.inputSchema.properties.status as { enum: string[] };
  assert.ok(prop.enum.includes('delivered'));
});
```

**Step 2: Run — FAIL.**

**Step 3: Write tool-defs.ts** (gbrain's mapper, our types):

```ts
// bomdb/src/tool-defs.ts
// Lifted from gbrain src/mcp/tool-defs.ts (MIT) — registry → MCP tool schemas.
import type { Operation, ParamDef } from './operations.ts';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export function paramDefToSchema(p: ParamDef): Record<string, unknown> {
  return {
    type: p.type,
    ...(p.description ? { description: p.description } : {}),
    ...(p.enum ? { enum: p.enum } : {}),
    ...(p.items ? { items: paramDefToSchema(p.items) } : {}),
  };
}

export function buildToolDefs(ops: Operation[]): McpToolDef[] {
  return ops.map(op => ({
    name: op.name,
    description: op.description,
    inputSchema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(op.params).map(([k, v]) => [k, paramDefToSchema(v)]),
      ),
      required: Object.entries(op.params)
        .filter(([, v]) => v.required)
        .map(([k]) => k),
    },
  }));
}
```

**Step 4: Write server.ts**

```ts
// bomdb/src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createEngine } from './engine.ts';
import { operations, runOp } from './operations.ts';
import { buildToolDefs } from './tool-defs.ts';

const engine = await createEngine();
await engine.initSchema();

const server = new Server(
  { name: 'bomdb', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildToolDefs(operations),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;
  const result = await runOp(engine, name, (params ?? {}) as Record<string, unknown>);
  const isError = typeof result === 'object' && result !== null && 'error' in result;
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
});

// Exit cleanly when the parent (Claude) closes the pipe.
process.stdin.on('close', async () => { await engine.close(); process.exit(0); });

await server.connect(new StdioServerTransport());
console.error('bomdb MCP server running (stdio)');
```

**Step 5: Run all tests — expect everything green.**

```bash
npm test
```

**Step 6: Manual boot check** (PGLite writes to a scratch dir, then clean up):

```bash
BOMDB_DATA_DIR=/tmp/bomdb-boot-test timeout 3 node src/server.ts; echo "exit=$?"
# Expect: "bomdb MCP server running (stdio)" on stderr, then timeout kill (exit=124)
rm -rf /tmp/bomdb-boot-test
```

**Step 7: Commit** — `git commit -m "feat(bomdb): MCP stdio server"`

---

### Task 9: Register with Claude Code + end-to-end smoke

**Files:**
- Modify: `store/README.md` (add the bomdb resolution note)
- Modify: `README.md` (mark the MCP as built)

**Step 1: Register the server (user scope — works from any directory)**

```bash
claude mcp remove bomdb -s user 2>/dev/null || true
claude mcp add --scope user bomdb -- node /Users/eshantarneja/Documents/Git/procurement-pack/bomdb/src/server.ts
claude mcp list
```
Expected: `bomdb ... Connected`.

**Step 2: End-to-end smoke (new Claude session, or this one after restart)**

Ask Claude to: create a project `arduino-dogfood`, add a spec, add a line item, try to move it backward (expect the confirmation refusal), record a shipped event, run stale_orders, export_json. Every call should round-trip through the real PGLite at `~/.bomdb/data`.

**Step 3: Update store/README.md** — in the resolution-order section, note that backend (1) "Postgres MCP" is now concretely `bomdb` and where it lives.

**Step 4: Update README.md work-split section** — Postgres + MCP connector: done.

**Step 5: Commit + hand off**

```bash
git add -A && git commit -m "feat(bomdb): register with Claude Code, docs updated"
```

Then merge/PR per superpowers:finishing-a-development-branch, and tell Bill the store's backend (1) is live — his skills should start resolving it.

---

## Deliberately NOT in v1 (YAGNI, revisit when real)

- **RLS / users rows** — week 1 is Eshan + Bill on their own machines (local PGLite is physically isolated). Hosted multi-user comes with the first external user.
- **HTTP/remote transport** — needed for claude.ai scheduled tasks + Cowork; build after the stdio version proves the ops. This is also the "approved connector" path.
- **Migration runner** — schema.sql is idempotent; first real schema change adds gbrain-style MIGRATIONS then.
- **PGLite single-writer lock** — one Claude session per machine in practice for week 1; steal gbrain's pglite-lock.ts (minus the force-break branch) if concurrent sessions become real.
- **CLI surface** — the ops registry makes it a ~30-line add later (gbrain pattern); nothing needs it yet.
