# Phase 1: Hosted bomdb Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The real bomdb tools (projects, specs, BOM, orders) served from Cloud Run so Eshan's actual BOM answers on claude.ai web and mobile.

**Architecture:** `bomdb-remote` reuses `bomdb/src/{engine,operations,tool-defs}.ts` verbatim via relative imports — one behavior, two transports (stdio local, streamable HTTP hosted). Interim auth is a secret URL path (`/mcp/<token>`): claude.ai cannot send custom headers on custom connectors, so until Phase 2's OAuth the URL itself is the credential. The engine boots once with Eshan's RLS-scoped `DATABASE_URL` (pooler form — Cloud Run egress is IPv4; the direct Supabase host is IPv6-only). Docker build context moves to the repo root so the image contains both packages.

**Tech Stack:** unchanged from Phase 0 (Node 24 container, MCP SDK, Express). Tests: `node --test` + `createTestEngine()` (in-memory PGLite) + real HTTP via `fetch` against an ephemeral port.

**Design doc:** `2026-08-03-hosted-connector-onboarding-design.md` (see Phase 0 results)

---

### Task 1: Failing test for the real HTTP app

**Files:**
- Create: `bomdb-remote/test/app.test.ts`
- Modify: `bomdb-remote/package.json` (add test script + PGLite devDep)

**Step 1: Add to `bomdb-remote/package.json` scripts:**
`"test": "node --test 'test/**/*.test.ts'"`
and devDependencies: `"@electric-sql/pglite": "^0.2.0"` (createTestEngine resolves it from bomdb/node_modules when imported, but declare it here too so `npm ci` in bomdb-remote alone stays sufficient for tests). Run `npm install` in `bomdb-remote/`.

**Step 2: Write `bomdb-remote/test/app.test.ts`:**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { buildApp } from '../src/app.ts';

const TOKEN = 'test-token-123';
let engine: Engine;
let base: string;
let server: ReturnType<ReturnType<typeof buildApp>['listen']>;

before(async () => {
  engine = await createTestEngine();
  const app = buildApp(engine, TOKEN);
  server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  server.close();
  await engine.close();
});

async function rpc(path: string, body: object) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  return res;
}

function parseSse(text: string) {
  const data = text.split('\n').find(l => l.startsWith('data: '));
  return JSON.parse(data!.slice(6));
}

test('wrong token is rejected with 401', async () => {
  const res = await rpc('/mcp/wrong-token', {
    jsonrpc: '2.0', id: 1, method: 'tools/list',
  });
  assert.equal(res.status, 401);
});

test('initialize handshake answers with server info', async () => {
  const res = await rpc(`/mcp/${TOKEN}`, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  assert.equal(res.status, 200);
  const msg = parseSse(await res.text());
  assert.equal(msg.result.serverInfo.name, 'bomdb-remote');
});

test('tools/list exposes real bomdb ops plus ping', async () => {
  const res = await rpc(`/mcp/${TOKEN}`, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const msg = parseSse(await res.text());
  const names = msg.result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes('create_project'), `missing create_project in ${names}`);
  assert.ok(names.includes('ping'));
});

test('create_project then list_projects round-trips through HTTP', async () => {
  const create = await rpc(`/mcp/${TOKEN}`, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'create_project', arguments: { name: 'HTTP transport test' } },
  });
  assert.equal(create.status, 200);
  const list = await rpc(`/mcp/${TOKEN}`, {
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'list_projects', arguments: {} },
  });
  const msg = parseSse(await (list).text());
  assert.ok(msg.result.content[0].text.includes('HTTP transport test'));
});
```

NOTE: adjust `create_project`/`list_projects` arg shapes to whatever
`operations.ts` actually requires (read the op defs first — e.g. the
project op may take `description` or return ids differently). The test
must use real op names/params from the registry, not guesses.

**Step 3: Run to verify it fails for the right reason**

Run: `cd bomdb-remote && npm test`
Expected: FAIL — `Cannot find module '../src/app.ts'`

---

### Task 2: Implement `app.ts`, make tests pass

**Files:**
- Create: `bomdb-remote/src/app.ts`
- Modify: `bomdb-remote/src/server.ts` (becomes thin entry point)

**Step 1: Create `bomdb-remote/src/app.ts`** — mirrors `bomdb/src/server.ts`'s handlers exactly, plus ping and token gate:

```ts
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Engine } from '../../bomdb/src/engine.ts';
import { operations, runOp } from '../../bomdb/src/operations.ts';
import { buildToolDefs } from '../../bomdb/src/tool-defs.ts';

const PING_TOOL = {
  name: 'ping',
  description: 'Health check for the procurement BOM connector. Returns proof the hosted server answered.',
  inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
};

function buildServer(engine: Engine) {
  const server = new Server(
    { name: 'bomdb-remote', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...buildToolDefs(operations), PING_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params;
    if (name === 'ping') {
      return {
        content: [{
          type: 'text',
          text: `pong from bomdb-remote at ${new Date().toISOString()} (revision ${process.env.K_REVISION ?? 'local'})`,
        }],
      };
    }
    const result = await runOp(engine, name, (params ?? {}) as Record<string, unknown>);
    const isError = typeof result === 'object' && result !== null && 'error' in result;
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      ...(isError ? { isError: true } : {}),
    };
  });
  return server;
}

export function buildApp(engine: Engine, token: string) {
  const app = express();
  app.use(express.json());

  // /healthz is reserved by Google's frontend on run.app — use /health.
  app.get('/health', (_req, res) => { res.status(200).send('ok'); });

  app.post('/mcp/:token', async (req, res) => {
    if (req.params.token !== token) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
      return;
    }
    const server = buildServer(engine);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('mcp request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
      }
    }
  });

  app.get('/mcp/:token', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });
  app.delete('/mcp/:token', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });

  return app;
}
```

**Step 2: Rewrite `bomdb-remote/src/server.ts` as the entry point:**

```ts
import { createEngine, ensureSchema } from '../../bomdb/src/engine.ts';
import { buildApp } from './app.ts';

const token = process.env.TOKEN;
if (!token) throw new Error('TOKEN env var is required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');

const engine = await createEngine();
await ensureSchema(engine);

const port = Number(process.env.PORT ?? 8080);
buildApp(engine, token).listen(port, () =>
  console.log(`bomdb-remote listening on :${port}`),
);
```

**Step 3: Run tests**

Run: `cd bomdb-remote && npm test`
Expected: all 4 tests PASS. Also run bomdb's own suite (`cd ../bomdb && npm test`) — must stay green (we import, never modify).

**Step 4: Commit**

```bash
git add bomdb-remote/
git commit -m "feat(bomdb-remote): serve real bomdb ops over streamable HTTP with URL-token auth"
```

---

### Task 3: Repo-root build context

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.gcloudignore` (repo root)
- Delete: `bomdb-remote/Dockerfile`, `bomdb-remote/.dockerignore` (superseded)

**Step 1: Root `Dockerfile`:**

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY bomdb/package.json bomdb/package-lock.json bomdb/
RUN cd bomdb && npm ci --omit=dev
COPY bomdb-remote/package.json bomdb-remote/package-lock.json bomdb-remote/
RUN cd bomdb-remote && npm ci --omit=dev
COPY bomdb/src bomdb/src
COPY bomdb-remote/src bomdb-remote/src
ENV NODE_ENV=production
CMD ["node", "bomdb-remote/src/server.ts"]
```

**Step 2: Root `.gcloudignore`:**

```
.git
node_modules
**/node_modules
docs
evals
store
skills
.claude
```

**Step 3: Commit** (`chore(bomdb-remote): repo-root Docker build context`)

---

### Task 4: Deploy — ESHAN RUNS THE DEPLOY COMMAND (classifier blocks Claude)

**Step 1: Generate the URL token and env file (Claude):**

`openssl rand -hex 24` → TOKEN. Create `bomdb-remote/env.yaml`
(**verify gitignored** — add `env.yaml` to `bomdb-remote/.gitignore`):

```yaml
TOKEN: "<generated>"
DATABASE_URL: "<pooler-form string from bomdb/.env>"
```

DATABASE_URL MUST be the pooler form (`aws-0-us-west-1.pooler.supabase.com`,
user `postgres.damtdwktzahrehjyxpow`) — Cloud Run cannot reach the
IPv6-only direct host.

**Step 2: Eshan runs (via `!` prefix):**

```bash
gcloud run deploy bomdb-remote --source . --region us-central1 \
  --allow-unauthenticated --project carbonella \
  --env-vars-file bomdb-remote/env.yaml --quiet
```

(`--allow-unauthenticated` still correct: auth is the secret path; Phase 2
replaces it with OAuth.)

**Step 3: Verify from Claude with curl** — initialize, then
`tools/call list_projects` against
`https://bomdb-remote-869731474645.us-central1.run.app/mcp/<TOKEN>`.
Expected: Eshan's real projects (3 as of 2026-08-03). Also verify the OLD
`/mcp` path (no token) now 404s — the toy is gone.

---

### Task 5: [ESHAN — claude.ai UI] Point the connector at the real server

1. Settings → Connectors → edit `BOM DB test` (or remove + re-add, name it
   `BOM DB`): URL = `https://bomdb-remote-869731474645.us-central1.run.app/mcp/<TOKEN>`.
2. New chat on claude.ai web: **"Using the BOM DB connector, what projects
   do I have and what's in my BOM?"**
   ✅ Pass = his real projects/specs/orders, matching what Desktop shows.
3. Same question on the phone. ✅ Same data.
4. This is the Phase 1 exit test from the design doc.

---

### Task 6: De-dup the local server + record results

1. With the real connector live, Desktop/Cowork now see TWO identical
   toolsets (local stdio bomdb + account connector). Remove the `bomdb`
   entry from `~/Library/Application Support/Claude/claude_desktop_config.json`
   (keep the `.bak-pooler` backup; `bomdb/.env` stays as canonical creds).
   Ask Eshan whether to also `claude mcp remove bomdb -s user` (terminal) —
   the account connector covers it, but he may want the local one for
   offline/dev work.
2. Append `## Phase 1 results` to the design doc: what shipped, exit-test
   outcomes per surface, the token-in-URL interim and its rotation story
   (change env var + connector URL), anything that surprised.
3. Commit and push.
