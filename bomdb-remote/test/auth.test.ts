import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import { createTestEngine, type Engine } from '../../bomdb/src/engine.ts';
import { buildApp } from '../src/app.ts';
import { tokenForRole } from '../src/auth.ts';

// /auth/register + /auth/login against an in-memory PGLite master engine,
// same faking pattern as app.test.ts. Fake tokens only — never real ones.
const CLARK_TOKEN = 'fake-token-clark';
let master: Engine;
let base: string;
let server: HttpServer;
let clarkId: string;

before(async () => {
  master = await createTestEngine();
  const [clark] = await master.query<{ id: string }>(
    `INSERT INTO users (name, email, pg_role) VALUES ('Clark', 'clark@example.com', 'clark') RETURNING id`);
  clarkId = clark.id;
  // whitelisted but not provisioned into the token map
  await master.query(
    `INSERT INTO users (name, email, pg_role) VALUES ('Danny', 'danny@example.com', 'danny')`);
  const app = buildApp(async () => null, {
    master: async () => master,
    tokenForRole: role => (role === 'clark' ? CLARK_TOKEN : null),
  });
  server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  server.close();
  await master.close();
});

async function post(path: string, body: object) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('register rejects an email that is not on the invite list', async () => {
  const res = await post('/auth/register', { email: 'stranger@example.com', password: 'longenough1' });
  assert.equal(res.status, 403);
  assert.match(String(res.body.error), /invite list/);
});

test('register rejects a short password', async () => {
  const res = await post('/auth/register', { email: 'clark@example.com', password: 'short' });
  assert.equal(res.status, 400);
});

test('register then login round-trips and returns the existing token', async () => {
  const reg = await post('/auth/register', { email: 'Clark@Example.com', password: 'correct horse battery' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.equal(reg.body.token, CLARK_TOKEN);
  assert.equal(reg.body.name, 'Clark');

  // password is stored hashed, never in the clear
  const [row] = await master.query<{ email: string; password_hash: string }>(
    `SELECT email, password_hash FROM app_accounts WHERE user_id = $1`, [clarkId]);
  assert.equal(row.email, 'clark@example.com'); // normalized to lowercase
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('correct horse battery'));

  const login = await post('/auth/login', { email: 'clark@example.com', password: 'correct horse battery' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.token, CLARK_TOKEN);
  assert.equal(login.body.name, 'Clark');
});

test('registering twice answers 409', async () => {
  const res = await post('/auth/register', { email: 'clark@example.com', password: 'another password' });
  assert.equal(res.status, 409);
});

test('wrong password and unknown email get the same generic 401', async () => {
  const wrong = await post('/auth/login', { email: 'clark@example.com', password: 'not the password' });
  assert.equal(wrong.status, 401);
  const unknown = await post('/auth/login', { email: 'stranger@example.com', password: 'whatever12' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body, 'unknown email must be indistinguishable from wrong password');
});

test('whitelisted user without a token-map entry cannot finish registration', async () => {
  const res = await post('/auth/register', { email: 'danny@example.com', password: 'longenough1' });
  assert.equal(res.status, 403);
  assert.match(String(res.body.error), /provisioned/);
});

test('malformed bodies are rejected with 400', async () => {
  for (const body of [{}, { email: 'clark@example.com' }, { email: 'not-an-email', password: 'longenough1' }]) {
    const res = await post('/auth/login', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('tokenForRole maps pooler and bare usernames, ignores junk', () => {
  const map = {
    'tok-a': 'postgres://eshan.abcdef:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres',
    'tok-b': 'postgres://clark:pw@db.example.com:5432/postgres',
    'tok-junk': 'not a url',
  };
  assert.equal(tokenForRole(map, 'eshan'), 'tok-a');
  assert.equal(tokenForRole(map, 'clark'), 'tok-b');
  assert.equal(tokenForRole(map, 'nobody'), null);
});

test('auth endpoints answer 503 when no master connection is configured', async () => {
  const bare = buildApp(async () => null);
  const s = bare.listen(0);
  const addr = s.address();
  const bareBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${bareBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co', password: 'longenough1' }),
    });
    assert.equal(res.status, 503);
  } finally {
    s.close();
  }
});
