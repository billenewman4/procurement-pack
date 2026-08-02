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
