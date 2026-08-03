import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { buildApp } from '../src/app.ts';

const TOKEN = 'test-token-123';
const TOKEN_B = 'test-token-456';
let engine: Engine;
let engineB: Engine;
let base: string;
let server: HttpServer;

before(async () => {
  engine = await createTestEngine();
  engineB = await createTestEngine();
  const engines: Record<string, Engine> = { [TOKEN]: engine, [TOKEN_B]: engineB };
  const app = buildApp(async token => engines[token] ?? null);
  server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  server.close();
  await engine.close();
  await engineB.close();
});

async function rpc(path: string, body: object) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

function parseSse(text: string) {
  const data = text.split('\n').find(l => l.startsWith('data: '));
  assert.ok(data, `no SSE data line in response: ${text}`);
  return JSON.parse(data.slice(6));
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
  assert.ok(names.includes('ping'), `missing ping in ${names}`);
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
  const msg = parseSse(await list.text());
  assert.ok(msg.result.content[0].text.includes('HTTP transport test'));
});

test('tokens are isolated: token B cannot see token A projects', async () => {
  await rpc(`/mcp/${TOKEN}`, {
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'create_project', arguments: { name: 'private-to-A' } },
  });
  const listB = await rpc(`/mcp/${TOKEN_B}`, {
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'list_projects', arguments: {} },
  });
  const msg = parseSse(await listB.text());
  assert.ok(!msg.result.content[0].text.includes('private-to-A'),
    'token B saw token A data');
});
