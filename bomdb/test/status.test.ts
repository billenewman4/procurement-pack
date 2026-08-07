import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForwardMove, eventToStatus, normalizeStatus, STATUSES } from '../src/status.ts';

test('forward moves are allowed', () => {
  assert.equal(isForwardMove('cart', 'ordered'), true);
  assert.equal(isForwardMove('quoting', 'ordered'), true);
  assert.equal(isForwardMove('cart', 'delivered'), true); // skipping is fine
  assert.equal(isForwardMove('ordered', 'delivered'), true);
});

test('quoting and cart are peers — both directions are free', () => {
  assert.equal(isForwardMove('cart', 'quoting'), true);
  assert.equal(isForwardMove('quoting', 'cart'), true);
});

test('backward moves are not forward', () => {
  assert.equal(isForwardMove('delivered', 'ordered'), false);
  assert.equal(isForwardMove('ordered', 'cart'), false);
  assert.equal(isForwardMove('ordered', 'quoting'), false);
  assert.equal(isForwardMove('quoting', 'quoting'), false); // no-op isn't forward
});

test('retired statuses are never forward moves', () => {
  assert.equal(isForwardMove('cart', 'shipped'), false);
  assert.equal(isForwardMove('ordered', 'issue'), false);
  assert.equal(isForwardMove('issue', 'ordered'), false);
  assert.equal(isForwardMove('researching', 'rfq'), false); // pre-rename vocab
});

test('events imply statuses; shipped is an event, not a status', () => {
  assert.equal(eventToStatus('confirmed'), 'ordered');
  assert.equal(eventToStatus('shipped'), 'ordered');
  assert.equal(eventToStatus('delivered'), 'delivered');
  assert.equal(eventToStatus('backordered'), null);
  assert.equal(eventToStatus('issue'), null);
});

test('legacy statuses normalize to the current lifecycle', () => {
  // pre-2026-08-04 vocab
  assert.equal(normalizeStatus('needed'), 'cart');
  assert.equal(normalizeStatus('shipped'), 'ordered');
  assert.equal(normalizeStatus('issue'), 'ordered');
  // 2026-08-06 rename
  assert.equal(normalizeStatus('researching'), 'cart');
  assert.equal(normalizeStatus('rfq'), 'quoting');
  assert.equal(normalizeStatus('po_placed'), 'ordered');
  // current values pass through
  assert.equal(normalizeStatus('cart'), 'cart');
  assert.equal(normalizeStatus('quoting'), 'quoting');
  assert.equal(normalizeStatus('ordered'), 'ordered');
  assert.equal(normalizeStatus('delivered'), 'delivered');
});

test('STATUSES exports the canonical order', () => {
  assert.deepEqual(STATUSES, ['quoting', 'cart', 'ordered', 'delivered']);
});
