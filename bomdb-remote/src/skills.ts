// Serves skill files through the connector so clients never fetch GitHub
// URLs themselves — claude.ai-side web fetches proved to serve stale CDN
// copies (2026-08-05: a "fresh" fetch of bom-dashboard returned a days-old
// revision even with a cache-buster). The GitHub contents API serves the
// current commit; raw.githubusercontent is only the fallback.

export const SKILL_NAMES = ['vendor-sweep', 'part-search', 'gmail-orders', 'bom-dashboard'];

const REPO_API = 'https://api.github.com/repos/billenewman4/procurement-pack/contents/skills';
const RAW = 'https://raw.githubusercontent.com/billenewman4/procurement-pack/main/skills';

export const GET_SKILL_TOOL = {
  name: 'get_skill',
  description:
    `Fetch the CURRENT text of one of this connector's skills (${SKILL_NAMES.join(', ')}) straight from the source repo — always fresh. Use this instead of fetching GitHub skill URLs yourself (web fetches serve stale cached copies), then present a save card from the returned text.`,
  inputSchema: {
    type: 'object' as const,
    properties: { name: { type: 'string', enum: SKILL_NAMES, description: 'Skill to fetch' } },
    required: ['name'] as string[],
  },
};

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
