/** Sourcing-agent proxy — bomdb-remote is the single connector users
 * install, so the deep-sourcing tools ride along here as thin relays to
 * the hosted sourcing-agent MCP service. SOURCING_AGENT_URL is the full
 * upstream endpoint including its partner token (https://host/mcp/<token>);
 * this server holds the only copy, users never see it. When the var is
 * unset the tools are not advertised, so a deployment without sourcing
 * degrades to plain bomdb instead of shipping tools that always fail. */

export function sourcingUrl(): string | null {
  return process.env.SOURCING_AGENT_URL?.trim() || null;
}

export const SOURCING_TOOLS = [
  {
    name: 'source_quote',
    description:
      'Start a deep sourcing run for one part: an agent searches real vendor '
      + 'catalogs and returns priced, in-stock options. Returns a quote_id '
      + 'immediately — poll get_quote for the result (typically ready in 2-5 '
      + 'minutes; tell the user, do other work, then check). When a quote '
      + 'completes, offer to add the chosen option to the BOM as a line item.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        part_description: {
          type: 'string',
          description: 'What to source, with specs that matter (size, material, standard)',
        },
        quantity: { type: 'integer', minimum: 1 },
        tier: {
          type: 'string',
          enum: ['prototype', 'production'],
          description: "Default 'prototype'",
        },
        notes: { type: 'string', description: 'Constraints or context for the sourcing agent' },
      },
      required: ['part_description', 'quantity'] as string[],
    },
  },
  {
    name: 'get_quote',
    description:
      'Fetch a sourcing quote by quote_id. Returns the quote whatever its '
      + 'status (pending / complete / no_results / failed) — poll every '
      + 'minute or so while pending.',
    inputSchema: {
      type: 'object' as const,
      properties: { quote_id: { type: 'string' } },
      required: ['quote_id'] as string[],
    },
  },
];

const SOURCING_TOOL_NAMES = new Set(SOURCING_TOOLS.map(t => t.name));

export function isSourcingTool(name: string): boolean {
  return SOURCING_TOOL_NAMES.has(name);
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function errResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Relay one tools/call to the sourcing service and pass its result
 * through untouched — upstream speaks MCP too, so its result shape is
 * already exactly what our caller expects. */
export async function callSourcing(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const url = sourcingUrl();
  if (!url) {
    return errResult('sourcing is not configured on this server (SOURCING_AGENT_URL unset)');
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return errResult(`sourcing service unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    return errResult(`sourcing service answered HTTP ${res.status}`);
  }
  const body = await res.text();
  let msg: { result?: ToolResult; error?: { message?: string } };
  try {
    // Upstream runs json_response mode, but tolerate an SSE-framed reply
    // so a future transport flip there doesn't silently break us.
    const data = body.startsWith('event:') || body.startsWith('data:')
      ? body.split('\n').find(l => l.startsWith('data: '))?.slice(6) ?? body
      : body;
    msg = JSON.parse(data);
  } catch {
    return errResult(`sourcing service sent an unparseable reply: ${body.slice(0, 200)}`);
  }
  if (msg.error) {
    return errResult(`sourcing service error: ${msg.error.message ?? 'unknown'}`);
  }
  if (!msg.result?.content) {
    return errResult('sourcing service reply had no result content');
  }
  return msg.result;
}
