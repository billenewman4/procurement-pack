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
