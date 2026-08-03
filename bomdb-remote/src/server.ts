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
