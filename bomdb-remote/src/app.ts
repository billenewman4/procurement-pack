import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Engine } from '../../bomdb/src/engine.ts';
import { operations, runOp } from '../../bomdb/src/operations.ts';
import { buildToolDefs } from '../../bomdb/src/tool-defs.ts';
import { GET_STARTED_TOOL, getStartedText, EMPTY_WORKSPACE_HINT } from './concierge.ts';
import { GET_SKILL_TOOL, getSkillText, getSkillStub } from './skills.ts';
import { SOURCING_TOOLS, isSourcingTool, callSourcing, sourcingUrl } from './sourcing.ts';
import { mountAuth, type AuthOptions } from './auth.ts';

const PING_TOOL = {
  name: 'ping',
  description: 'Health check for the procurement BOM connector. Returns proof the hosted server answered.',
  inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
};

function buildServer(engine: Engine) {
  const server = new Server(
    { name: 'bomdb-remote', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...buildToolDefs(operations),
      GET_STARTED_TOOL,
      GET_SKILL_TOOL,
      PING_TOOL,
      ...(sourcingUrl() ? SOURCING_TOOLS : []),
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params;
    if (name === 'ping') {
      return {
        content: [{
          type: 'text' as const,
          text: `pong from bomdb-remote at ${new Date().toISOString()} (revision ${process.env.K_REVISION ?? 'local'})`,
        }],
      };
    }
    if (name === 'get_started') {
      return { content: [{ type: 'text' as const, text: await getStartedText(engine) }] };
    }
    if (name === 'get_skill') {
      try {
        const p = (params ?? {}) as Record<string, unknown>;
        const skillName = String(p.name ?? '');
        const text = p.form === 'stub' ? getSkillStub(skillName) : await getSkillText(skillName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    }
    if (isSourcingTool(name)) {
      return callSourcing(name, (params ?? {}) as Record<string, unknown>);
    }
    const result = await runOp(engine, name, (params ?? {}) as Record<string, unknown>);
    const isError = typeof result === 'object' && result !== null && 'error' in result;
    const content = [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }];
    if (name === 'list_projects' && Array.isArray(result) && result.length === 0) {
      content.push({ type: 'text' as const, text: EMPTY_WORKSPACE_HINT });
    }
    return { content, ...(isError ? { isError: true } : {}) };
  });
  return server;
}

/** Maps a URL token to that user's engine; null → 401. */
export type EngineResolver = (token: string) => Promise<Engine | null>;

export function buildApp(resolveEngine: EngineResolver, auth?: AuthOptions) {
  const app = express();
  app.use(express.json());
  // Cloud Run sits behind Google's proxy; trust it so req.ip (used by the
  // auth rate limiter) is the caller, not the frontend.
  app.set('trust proxy', true);

  // /healthz is reserved by Google's frontend on run.app — use /health.
  app.get('/health', (_req, res) => { res.status(200).send('ok'); });

  // /auth/register + /auth/login (503 when no master connection configured).
  mountAuth(app, auth ?? null);

  app.post('/mcp/:token', async (req, res) => {
    const engine = await resolveEngine(req.params.token).catch(err => {
      console.error('engine resolution failed:', err);
      return null;
    });
    if (!engine) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
      return;
    }
    const server = buildServer(engine);
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
  app.get('/mcp/:token', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });
  app.delete('/mcp/:token', (_req, res) => { res.status(405).set('Allow', 'POST').send(); });

  return app;
}
