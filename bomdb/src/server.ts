import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createEngine } from './engine.ts';
import { operations, runOp } from './operations.ts';
import { buildToolDefs } from './tool-defs.ts';

const engine = await createEngine();
await engine.initSchema();

const server = new Server(
  { name: 'bomdb', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildToolDefs(operations),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;
  const result = await runOp(engine, name, (params ?? {}) as Record<string, unknown>);
  const isError = typeof result === 'object' && result !== null && 'error' in result;
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
});

// Exit cleanly when the parent (Claude) closes the pipe.
process.stdin.on('close', async () => { await engine.close(); process.exit(0); });

await server.connect(new StdioServerTransport());
console.error('bomdb MCP server running (stdio)');
