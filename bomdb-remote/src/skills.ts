// Serves skill files through the connector so clients never fetch GitHub
// URLs themselves — claude.ai-side web fetches proved to serve stale CDN
// copies (2026-08-05: a "fresh" fetch of bom-dashboard returned a days-old
// revision even with a cache-buster). The GitHub contents API serves the
// current commit; raw.githubusercontent is only the fallback.

export const SKILL_NAMES = ['vendor-sweep', 'part-search', 'gmail-orders', 'bom-dashboard', 'dashboard-upgrade'];

const REPO_API = 'https://api.github.com/repos/billenewman4/procurement-pack/contents/skills';
const RAW = 'https://raw.githubusercontent.com/billenewman4/procurement-pack/main/skills';

export const GET_SKILL_TOOL = {
  name: 'get_skill',
  description:
    `Fetch the CURRENT text of one of this connector's playbooks (${SKILL_NAMES.join(', ')}) straight from the source repo — always fresh. Use this instead of fetching GitHub skill URLs yourself (web fetches serve stale cached copies). form 'full' (default) returns the playbook to FOLLOW NOW; form 'stub' returns a tiny save-card version that auto-fetches the current playbook when triggered — use 'stub' when saving skills for the user, never save the full text.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', enum: SKILL_NAMES, description: 'Playbook to fetch' },
      form: { type: 'string', enum: ['full', 'stub'], description: "Default 'full'. 'stub' = ten-line save-card pointer that fetches the current playbook on use." },
    },
    required: ['name'] as string[],
  },
};

// Trigger descriptions mirror each SKILL.md's frontmatter. The stub a user
// saves is a pointer, not a copy — content is fetched at use time, so saved
// cards can never go stale.
const STUB_DESCRIPTIONS: Record<string, string> = {
  'vendor-sweep':
    'Use when building or refreshing the user\'s vendor list from purchase history in email — "set up my vendors", "scan my email for vendors", "who do I buy from" — or when invoked by the bomdb onboarding flow. Confident findings write immediately; ambiguous ones stay out.',
  'part-search':
    'Use when the user wants to find, source, compare, or buy a physical part or component — screws, fasteners, connectors, circuit boards, sensors, converters, raw material — or asks "where can I get X", mentions McMaster/Digi-Key/Amazon/Mouser, or is building a BOM.',
  'gmail-orders':
    'Use when checking email for purchase/order updates — order confirmations, shipping notices, delivery notices, backorders — or when the user asks "what\'s the status of my orders", "did everything ship", or wants the BOM/order tracker reconciled with their inbox.',
  'bom-dashboard':
    'Use when the user asks to see their BOM, project status, dashboard, spending, order pipeline, vendors, or "show me where everything is" — renders their procurement data from the BOM database.',
  'dashboard-upgrade':
    'Use in Claude Code when the user pastes the deluxe-dashboard line or asks for the live / clickable / bookmarkable BOM dashboard — publishes their personal live dashboard page (real write-back buttons) through their Lora connector.',
};

export function getSkillStub(name: string): string {
  if (!SKILL_NAMES.includes(name)) {
    throw new Error(`unknown skill "${name}" — valid: ${SKILL_NAMES.join(', ')}`);
  }
  return `---
name: ${name}
description: ${STUB_DESCRIPTIONS[name]}
---

This skill is a pointer — its real content lives on the user's BOM
connector and is always current there.

When this skill triggers: call the connector tool \`get_skill\` with
\`{"name": "${name}"}\` and follow the returned playbook exactly. Never
proceed from memory of a previous version, and never fetch skill files
from GitHub URLs (web fetches serve stale copies). If the BOM connector
is unavailable in this conversation, say so and stop — this skill cannot
run without it.
`;
}

// 60s cache: keeps a burst of four onboarding fetches to four upstream
// calls, without ever serving meaningfully stale text.
const cache = new Map<string, { text: string; at: number }>();
const TTL_MS = 60_000;

export async function getSkillText(name: string): Promise<string> {
  if (!SKILL_NAMES.includes(name)) {
    throw new Error(`unknown skill "${name}" — valid: ${SKILL_NAMES.join(', ')}`);
  }
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  let text = await fetchSkill(name);
  // Provenance stamp: lets any agent (or human) prove what it got and when,
  // without maintaining version fields in the skill files themselves.
  text += `\n\n<!-- served by bomdb get_skill at ${new Date().toISOString()} · ${text.length} chars · always current -->\n`;
  cache.set(name, { text, at: Date.now() });
  return text;
}

async function fetchSkill(name: string): Promise<string> {
  try {
    const r = await fetch(`${REPO_API}/${name}/SKILL.md`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'bomdb-remote',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return await r.text();
  } catch { /* fall through to raw */ }
  const r = await fetch(`${RAW}/${name}/SKILL.md`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`skill fetch failed: ${name} (${r.status})`);
  return await r.text();
}
