# Phase 0 De-Risk Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove the two bets the hosted-connector design rests on — that a Cloud Run MCP server is reachable as a claude.ai custom connector from every surface, and whether scheduled tasks can call it — before porting any real bomdb code.

**Architecture:** A throwaway stateless MCP server (`bomdb-remote/`, one `ping` tool, no auth, no database) served over streamable HTTP from Cloud Run. Every task ends in a verification with expected output. Tasks 6–8 are performed by Eshan in the claude.ai UI (OAuth-style account actions Claude cannot click); the plan states exactly what to do and what to record.

**Tech Stack:** Node ≥23.6 (native TS, same as bomdb), `@modelcontextprotocol/sdk` ^1.x (`StreamableHTTPServerTransport`, stateless mode), Express 4, Docker on Cloud Run via `gcloud run deploy --source`.

**Design doc:** `docs/plans/2026-08-03-hosted-connector-onboarding-design.md`

---

### Task 1: Scaffold the toy remote server

**Files:**
- Create: `bomdb-remote/package.json`
- Create: `bomdb-remote/src/server.ts`
- Create: `bomdb-remote/Dockerfile`
- Create: `bomdb-remote/.dockerignore`

**Step 1: Create `bomdb-remote/package.json`**

Matches bomdb's conventions (ESM, native TS on modern Node, no build step):

```json
{
  "name": "bomdb-remote",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Hosted MCP connector for procurement-pack (Phase 0: toy ping server)",
  "engines": { "node": ">=23.6" },
  "scripts": { "start": "node src/server.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.21.0"
  }
}
```

**Step 2: Create `bomdb-remote/src/server.ts`**

Stateless pattern: a fresh server + transport per POST, no session tracking —
each request is self-contained, which is what lets Cloud Run scale freely.

```ts
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

function buildServer() {
  const server = new McpServer({ name: 'bomdb-remote-toy', version: '0.0.1' });
  server.tool(
    'ping',
    'Health check for the procurement BOM connector. Call when the user asks to ping or test the connector; returns proof the hosted server answered.',
    {},
    async () => ({
      content: [{
        type: 'text' as const,
        text: `pong from Cloud Run at ${new Date().toISOString()} (revision ${process.env.K_REVISION ?? 'local'})`,
      }],
    }),
  );
  return server;
}

const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => { res.status(200).send('ok'); });

app.post('/mcp', async (req, res) => {
  const server = buildServer();
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

// Stateless: no standalone SSE stream, no sessions to close.
app.get('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });
app.delete('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`bomdb-remote listening on :${port}`));
```

**Step 3: Create `bomdb-remote/Dockerfile`**

Explicit Dockerfile rather than buildpacks so the Node version (native TS
needs ≥23.6) is under our control, not the buildpack's default:

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/server.ts"]
```

**Step 4: Create `bomdb-remote/.dockerignore`**

```
node_modules
```

**Step 5: Install deps (also generates the lockfile the Dockerfile needs)**

Run: `cd bomdb-remote && npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

---

### Task 2: Verify the server locally

**Step 1: Start the server**

Run: `cd bomdb-remote && npm start` (background it or use a second terminal)
Expected: `bomdb-remote listening on :8080`

**Step 2: Health check**

Run: `curl -s http://localhost:8080/healthz`
Expected: `ok`

**Step 3: MCP initialize handshake**

```bash
curl -sS -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Expected: a response (JSON or SSE `data:` line) containing
`"serverInfo":{"name":"bomdb-remote-toy"`. This is the pass/fail check —
if the handshake answers, claude.ai can talk to it.

**Step 4: Tool listing**

Same curl with body:
`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`

Expected: either a tool list containing `"name":"ping"` (pass), or a
"server not initialized" error — the latter is still fine at this stage
(claude.ai always sends initialize first; some SDK versions require it
per-request even in stateless mode). Record which you got.

**Step 5: Stop the local server.**

---

### Task 3: Commit the scaffold

```bash
git add bomdb-remote/
git commit -m "feat(bomdb-remote): Phase 0 toy MCP server over streamable HTTP

One unauthenticated ping tool, stateless transport, Dockerfile for Cloud
Run. De-risk step from the 2026-08-03 hosted-connector design — proves
custom-connector reachability before any real bomdb code is ported."
```

(Do NOT commit `node_modules` or `package-lock.json`? — DO commit
`package-lock.json`; the Dockerfile depends on it. Check `.gitignore`
covers `node_modules` for this new directory; bomdb's entry may be
path-specific.)

---

### Task 4: GCP project decision — CHECKPOINT WITH ESHAN

Eshan believes the account is at its GCP project quota. Do NOT silently
create or pick a project.

**Step 1: Inventory**

```bash
gcloud auth list
gcloud projects list --format='table(projectId,name)'
```

**Step 2: Report to Eshan and decide together:**
- If a suitable existing project exists (dev/sandbox-ish, has billing
  enabled): deploy there. Namespacing is by service name; a shared project
  is fine for Phase 0 and even Phase 1+.
- Only if he wants a dedicated project: try
  `gcloud projects create procurement-mcp --name="Procurement MCP"` — if it
  fails with a quota error, the fix is deleting an unused project or a
  quota-increase request, both Eshan's call.

**Step 3: Set the chosen project and enable APIs**

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Expected: `Operation ... finished successfully.`

---

### Task 5: Deploy to Cloud Run and verify publicly

**Step 1: Deploy**

```bash
gcloud run deploy bomdb-remote \
  --source bomdb-remote \
  --region us-central1 \
  --allow-unauthenticated
```

`--allow-unauthenticated` is deliberate and safe here: the toy serves no
data and holds no secrets. Real auth is Phase 2's OAuth; do not add interim
secrets to the toy.

Expected: build runs (uses our Dockerfile), then
`Service URL: https://bomdb-remote-<hash>-uc.a.run.app`

**Step 2: Repeat Task 2's health + initialize curls against the public URL**

Expected: identical results to local. If initialize hangs or 404s, check
`gcloud run services logs read bomdb-remote --region us-central1`.

**Step 3: Record the service URL** — it goes in the connector config next.

---

### Task 6: [ESHAN — claude.ai UI] Add the custom connector

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Name: `BOM DB test`. URL: `https://<service-url>/mcp`. No auth fields.
3. Click **Add**. **Record:** did claude.ai accept an unauthenticated
   connector without complaint? (This confirms the auth modes the UI
   allows — a design input for Phase 2.)
4. New chat (web) → enable the connector if prompted → say:
   **"Ping the BOM DB test connector and show me the exact response."**

Expected: Claude calls `ping` and relays `pong from Cloud Run at <time>
(revision …)`. That timestamp/revision string is proof the hosted server —
not a hallucination — answered.

---

### Task 7: [ESHAN — other surfaces] Cowork and mobile reach

1. **Cowork:** new session → same ping prompt. Expected: same pong.
2. **Mobile app:** new chat → same ping prompt. Expected: same pong.
3. **Record** any surface where the connector was missing or failed —
   surface availability is a design assumption, not yet a verified fact.

---

### Task 8: [ESHAN — claude.ai UI] Smoke test #1 — scheduled task → custom connector

The decision this whole task exists for: **can scheduled runs call custom
connectors?** This picks functionality 4's path (full sync vs. catch-up
fallback).

1. In a claude.ai chat: **"Create a scheduled task that runs once, 10
   minutes from now: call the ping tool on the BOM DB test connector and
   include the exact response text in your report."**
2. Wait for the run; open the task's result.
3. **Record verbatim** one of:
   - Result contains a fresh `pong … <timestamp>` → **scheduled runs CAN
     use custom connectors** → design's functionality 4 proceeds as full
     sync.
   - Result says the tool/connector was unavailable, or task creation
     refused → **fallback confirmed**: catch-up sweep on chat-open does
     the DB writes; scheduled runs stay report-only. Bill's honesty caveat
     in TEAM_SETUP.md stays.

Cross-check with Cloud Run logs (`gcloud run services logs read
bomdb-remote --region us-central1`) — a request logged at the scheduled
time is independent confirmation.

---

### Task 9: Record results and commit

**Files:**
- Modify: `docs/plans/2026-08-03-hosted-connector-onboarding-design.md` —
  append a `## Phase 0 results (2026-08-0X)` section.

**Step 1: Write down, factually:**
- Service URL, project ID chosen (and how the quota question resolved).
- Per-surface results (web / Cowork / mobile): worked or not, verbatim
  errors.
- Auth modes the connector UI offered/accepted.
- Smoke test #1 verdict and the exact evidence (task output + log line).
- The resulting decision for functionality 4.

**Step 2: Commit**

```bash
git add docs/plans/2026-08-03-hosted-connector-onboarding-design.md
git commit -m "docs: Phase 0 results — connector reachability + scheduled-task verdict"
```

**Step 3: Leave the service running** — Phase 1 replaces its contents but
reuses the service name, URL, and connector entry. Scale-to-zero means an
idle toy costs effectively nothing.
