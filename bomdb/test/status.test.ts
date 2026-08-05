import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForwardMove, eventToStatus, normalizeStatus, STATUSES } from '../src/status.ts';

test('forward moves are allowed', () => {
  assert.equal(isForwardMove('researching', 'rfq'), true);
  assert.equal(isForwardMove('researching', 'po_placed'), true); // skipping is fine
  assert.equal(isForwardMove('rfq', 'po_placed'), true);
  assert.equal(isForwardMove('po_placed', 'delivered'), true);
});

test('backward moves are not forward', () => {
  assert.equal(isForwardMove('delivered', 'po_placed'), false);
  assert.equal(isForwardMove('po_placed', 'researching'), false);
  assert.equal(isForwardMove('rfq', 'rfq'), false); // no-op isn't forward
});

test('retired statuses are never forward moves', () => {
  assert.equal(isForwardMove('researching', 'shipped'), false);
  assert.equal(isForwardMove('po_placed', 'issue'), false);
  assert.equal(isForwardMove('issue', 'po_placed'), false);
});

test('events imply statuses; shipped is an event, not a status', () => {
  assert.equal(eventToStatus('confirmed'), 'po_placed');
  assert.equal(eventToStatus('shipped'), 'po_placed');
  assert.equal(eventToStatus('delivered'), 'delivered');
  assert.equal(eventToStatus('backordered'), null);
  assert.equal(eventToStatus('issue'), null);
});

test('legacy statuses normalize to the four-state lifecycle', () => {
  assert.equal(normalizeStatus('needed'), 'researching');
  assert.equal(normalizeStatus('ordered'), 'po_placed');
  assert.equal(normalizeStatus('shipped'), 'po_placed');
  assert.equal(normalizeStatus('issue'), 'po_placed');
  assert.equal(normalizeStatus('researching'), 'researching');
  assert.equal(normalizeStatus('delivered'), 'delivered');
  assert.equal(normalizeStatus('rfq'), 'rfq'); // current values pass through
});

test('STATUSES exports the canonical order', () => {
  assert.deepEqual(STATUSES, ['researching', 'rfq', 'po_placed', 'delivered']);
});
