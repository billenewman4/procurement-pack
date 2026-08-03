import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionUrls, projectRef } from '../scripts/provision-lib.ts';

const REF = 'damtdwktzahrehjyxpow';
const DIRECT_MASTER = `postgresql://postgres:masterpw@db.${REF}.supabase.co:5432/postgres`;
const POOLER_MASTER = `postgresql://postgres.${REF}:masterpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;

test('projectRef extracts ref from direct and pooler hosts', () => {
  assert.equal(projectRef(DIRECT_MASTER), REF);
  assert.equal(projectRef(POOLER_MASTER), REF);
  assert.equal(projectRef('postgresql://u:p@localhost:5432/db'), null);
});

test('direct master yields both direct and pooler user URLs', () => {
  const { direct, pooler } = connectionUrls(DIRECT_MASTER, 'bill', 'pw123');
  assert.equal(direct, `postgresql://bill:pw123@db.${REF}.supabase.co:5432/postgres`);
  assert.equal(pooler, `postgresql://bill.${REF}:pw123@aws-0-us-west-1.pooler.supabase.com:5432/postgres`);
});

test('pooler master keeps its pooler host and yields both forms', () => {
  const { direct, pooler } = connectionUrls(POOLER_MASTER, 'bill', 'pw123');
  assert.equal(direct, `postgresql://bill:pw123@db.${REF}.supabase.co:5432/postgres`);
  assert.equal(pooler, `postgresql://bill.${REF}:pw123@aws-0-us-west-1.pooler.supabase.com:5432/postgres`);
});

test('non-supabase master falls back to credential swap, no pooler', () => {
  const { direct, pooler } = connectionUrls('postgresql://u:p@localhost:5432/db', 'bill', 'pw123');
  assert.equal(direct, 'postgresql://bill:pw123@localhost:5432/db');
  assert.equal(pooler, null);
});
