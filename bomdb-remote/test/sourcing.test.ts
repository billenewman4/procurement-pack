import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { buildApp } from '../src/app.ts';

const TOKEN = 'test-token-123';
let engine: Engine;
let base: string;
let server: HttpServer;
let upstream: HttpServer;
let upstreamCalls: { name: string; arguments: Record<string, unknown> }[];

before(async () => {
  // Fake sourcing-agent: records tools/call requests, answers like the
  // real FastMCP json_response server does.
  upstreamCalls = [];
  const fake = express();
  fake.use(express.json());
  fake.post('/mcp/fake-partner-token', (req, res) => {
    upstreamCalls.push(req.body.params);
    const payload = req.body.params.name === 'source_quote'
      ? { quote_id: 'q_test123', status: 'pending', eta_minutes: 5 }
      : { quote_id: req.body.params.arguments.quote_id, status: 'complete', lines: [] };
    res.json({
      jsonrpc: '2.0', id: req.body.id,
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false },
    });
  });
  upstream = fake.listen(0);
  const upAddr = upstream.address();
  const upPort = typeof upAddr === 'object' && upAddr ? upAddr.port : 0;
  process.env.SOURCING_AGENT_URL = `http://127.0.0.1:${upPort}/mcp/fake-partner-token`;

  engine = await createTestEngine();
  const app = buildApp(async token => (token === TOKEN ? engine : null));
  server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  delete process.env.SOURCING_AGENT_URL;
  server.close();
  upstream.close();
  await engine.close();
});

async function rpc(body: object) {
  return fetch(`${base}/mcp/${TOKEN}`, {
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

test('sourcing tools are advertised when SOURCING_AGENT_URL is set', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = parseSse(await res.text()).result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes('source_quote'), `missing source_quote in ${names}`);
  assert.ok(names.includes('get_quote'), `missing get_quote in ${names}`);
});

test('source_quote relays args upstream and returns its reply verbatim', async () => {
  const res = await rpc({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: {
      name: 'source_quote',
      arguments: { part_description: 'M3x10 SHCS stainless', quantity: 100 },
    },
  });
  const msg = parseSse(await res.text());
  assert.ok(!msg.result.isError, `unexpected error: ${JSON.stringify(msg.result)}`);
  assert.match(msg.result.content[0].text, /q_test123/);
  const relayed = upstreamCalls.find(c => c.name === 'source_quote');
  assert.ok(relayed, 'upstream never saw source_quote');
  assert.equal(relayed.arguments.part_description, 'M3x10 SHCS stainless');
  assert.equal(relayed.arguments.quantity, 100);
});

test('get_quote relays the quote_id and returns the quote', async () => {
  const res = await rpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'get_quote', arguments: { quote_id: 'q_test123' } },
  });
  const msg = parseSse(await res.text());
  assert.match(msg.result.content[0].text, /"status": *"complete"/);
});

test('unreachable sourcing service degrades to isError, not a crash', async () => {
  const saved = process.env.SOURCING_AGENT_URL;
  process.env.SOURCING_AGENT_URL = 'http://127.0.0.1:1/mcp/nope';
  try {
    const res = await rpc({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_quote', arguments: { quote_id: 'q_x' } },
    });
    const msg = parseSse(await res.text());
    assert.ok(msg.result.isError, 'expected isError result');
    assert.match(msg.result.content[0].text, /unreachable/);
  } finally {
    process.env.SOURCING_AGENT_URL = saved;
  }
});

test('without SOURCING_AGENT_URL the tools disappear from tools/list', async () => {
  const saved = process.env.SOURCING_AGENT_URL;
  delete process.env.SOURCING_AGENT_URL;
  try {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    const names = parseSse(await res.text()).result.tools.map((t: { name: string }) => t.name);
    assert.ok(!names.includes('source_quote'), `source_quote listed without config: ${names}`);
  } finally {
    process.env.SOURCING_AGENT_URL = saved;
  }
});
