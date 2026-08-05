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
      + 'immediately — poll get_quote for the result (typically ready in 5-10 '
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
        vendors: {
          type: 'string',
          description: 'Comma-separated vendor slugs (from connect_vendor / the vendors '
            + "table's sourcing_slug). Empty = all known vendors.",
        },
      },
      required: ['part_description', 'quantity'] as string[],
    },
  },
  {
    name: 'get_quote',
    description:
      'Fetch a sourcing quote by quote_id. Returns the quote whatever its '
      + 'status (pending / complete / no_results / rfq_drafted / failed — '
      + 'rfq_drafted means drafts but no priced lines, check rfq_drafts[]) — '
      + 'poll every minute or so while pending; typically ready in 5-10 minutes.',
    inputSchema: {
      type: 'object' as const,
      properties: { quote_id: { type: 'string' } },
      required: ['quote_id'] as string[],
    },
  },
  {
    name: 'connect_vendor',
    description:
      'Kick off vendor recon for one or more vendors: the sourcing agent '
      + 'researches each (site, catalog shape, how to source from it) and '
      + 'returns a canonical slug per vendor — store it as that vendor\'s '
      + 'sourcing_slug (upsert_vendor) and use it in source_quote\'s vendors '
      + 'filter. Recon runs in the background — do NOT wait for it or poll; '
      + 'the jobs are still pending when this call returns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vendors: {
          type: 'array',
          description: 'Vendors to research, e.g. [{"name": "Newark", "domain": "newark.com"}]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              domain: { type: 'string' },
              hints: { type: 'string', description: 'Freeform context to help recon' },
            },
            required: ['name'],
          },
        },
      },
      required: ['vendors'] as string[],
    },
  },
  {
    name: 'get_job',
    description:
      'Fetch a connect_vendor recon job by job_id. kind is "recon"; status is '
      + 'pending / complete / failed.',
    inputSchema: {
      type: 'object' as const,
      properties: { job_id: { type: 'string' } },
      required: ['job_id'] as string[],
    },
  },
  {
    name: 'list_sourcing_vendors',
    description:
      'List every vendor the sourcing agent knows how to reach: slug, '
      + 'display_name, kind ("house" or "connected"), and access. This is the '
      + "sourcing service's own connector catalog — distinct from bomdb's "
      + "list_vendors (the user's vendor CRM).",
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
];

const SOURCING_TOOL_NAMES = new Set(SOURCING_TOOLS.map(t => t.name));

export function isSourcingTool(name: string): boolean {
  return SOURCING_TOOL_NAMES.has(name);
}

/** Local tool name → upstream sourcing-agent tool name, for the one case
 *  where they differ: our combined tools/list already has a `list_vendors`
 *  (bomdb's vendor CRM), so the sourcing-agent's own `list_vendors` is
 *  exposed locally as `list_sourcing_vendors` and translated back to the
 *  upstream contract's real name here. */
const UPSTREAM_TOOL_NAME: Record<string, string> = {
  list_sourcing_vendors: 'list_vendors',
};

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
        params: { name: UPSTREAM_TOOL_NAME[name] ?? name, arguments: args },
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
