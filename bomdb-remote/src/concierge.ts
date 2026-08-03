// The first-run concierge: server-generated guidance that arrives with the
// connector, before any skill is saved. get_started doubles as the context
// loader for returning users. All text here is written FOR CLAUDE to act on,
// not to be recited verbatim to the user.
import type { Engine } from '../../bomdb/src/engine.ts';
import { runOp } from '../../bomdb/src/operations.ts';

const RAW = 'https://raw.githubusercontent.com/billenewman4/procurement-pack/main';

export const GET_STARTED_TOOL = {
  name: 'get_started',
  description:
    'Load the user\'s procurement context. Call this FIRST when the user says "set up my BOM" (or similar), asks anything about parts, BOMs, orders, vendors, or projects, or before any other bomdb tool in a conversation. Returns onboarding guidance for new users or a current-state briefing for returning users.',
  inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
};

interface DashboardData {
  projects: {
    id: string;
    name: string;
    spec_categories: string[];
    status_counts: Record<string, number>;
    total_committed: number;
    open_issues: number;
    stale_items: { description: string; vendor: string | null }[];
    recent_events: { event: string; vendor: string; event_at: string; raw_summary: string | null }[];
  }[];
}

const SPEC_CATEGORIES = ['power', 'connectors', 'mechanical', 'constraints'];

const DIGEST_TASK_PROMPT = `Run my morning order digest. Unattended run — no questions, no clarifying
prompts.

1. Sweep Gmail for order lifecycle emails since the last sync (default 7
   days, widen if there's a gap), three passes: category:purchases first;
   then targeted sweeps for vendor domains already in my BOM; then a broad
   pass over the window — forwarded and oddly-routed vendor emails only
   show up there. Read only sender/subject/snippet until an email is
   classified as an order event; discard everything else.
2. Record each event in the BOM connector with record_order_event, across
   all my projects. Quote order numbers and prices exactly, never infer.
   Leave line_item_id off anything below certain confidence — unmatched
   events are kept for manual reconciliation.
3. Report three short sections: UPDATED (item, old → new status, ETA),
   UNMATCHED (events needing my call), STALE (ordered 7+ days with no
   event — use the stale_orders tool; worth a vendor nudge).
4. If nothing moved, say so in one line and stop.`;

function newUserScript(): string {
  return `[bomdb concierge — NEW USER, empty workspace]

This user just connected and has no projects. Guide them through setup
conversationally — one step at a time, never as a wall of instructions.
Don't use our internal words (MCP, connector, tool names) with them.

1. WELCOME + FIRST PROJECT. Welcome them warmly in one line, then ask what
   they're building (one line is plenty). Create it with create_project.

2. SPEC INTERVIEW — once, right now, ~4 quick questions. Ask about:
   power (voltage/battery/wall), connectors (what it plugs into),
   mechanical (size/mounting/materials), constraints (budget, shipping
   urgency, country-of-origin preferences). Store each answer with
   upsert_spec (categories: ${SPEC_CATEGORIES.join(', ')}). If they defer,
   choose sensible beginner defaults, store them, and tell them what you
   chose. Read the stored specs back to them in one compact line.

3. UPGRADES (skills). Three skills belong with this connector:
   part-search — ${RAW}/skills/part-search/SKILL.md
   gmail-orders — ${RAW}/skills/gmail-orders/SKILL.md
   bom-dashboard — ${RAW}/skills/bom-dashboard/SKILL.md
   Check which are already active in this conversation. Already active →
   skip silently. For EACH one that is missing: fetch its file and package
   it as a skill with a save card — a skill being absent from their
   account is exactly the reason to package it, never a reason to skip.
   Offer first in one line ("I have N upgrades that make me sharper at
   X — want them?"), and after they save, tell them the skills take
   effect in their NEXT chat. Never claim this step is done until they
   confirm saving.

4. GMAIL (optional, never block). If Gmail tools are available in this
   conversation, confirm order tracking is on with the cheapest possible
   read. If not, say: "Connect Gmail in your Claude settings and I can
   track your orders automatically — everything else works without it."

5. MORNING DIGEST (only after Gmail works). Offer: "Want a weekday-morning
   order digest? I'll read your order emails, update your BOM, and send
   you a summary." If yes: create a scheduled task (weekdays, 8am their
   time) whose prompt is EXACTLY the text between the --- markers below.
   If you cannot create scheduled tasks from this conversation, give them
   that text verbatim instead and say: "Open Tasks → new task → paste
   this → set it to weekday mornings." The task prompt must BE the digest
   instructions — never a request to set up a digest (a task run can't
   schedule other tasks).
   ---
   ${DIGEST_TASK_PROMPT}
   ---

6. TEACH BY EXAMPLE, then stop. Tell them they can just talk: "find me a
   pressure sensor that fits my build", "I ordered the pump from McMaster",
   "catch me up on my orders", "show me my BOM". Mention you remember
   between chats so they never re-explain their project, and their data is
   private to them. Suggest one concrete first search built from the specs
   they just gave you.`;
}

function fmtCounts(counts: Record<string, number>): string {
  const order = ['needed', 'researching', 'ordered', 'shipped', 'delivered', 'issue'];
  const parts = order.filter(s => counts[s]).map(s => `${counts[s]} ${s}`);
  return parts.length ? parts.join(', ') : 'no line items yet';
}

function briefing(data: DashboardData): string {
  const lines: string[] = ['[bomdb concierge — returning user briefing. Use as context; don\'t recite it. If they asked to "set up my BOM", they\'re already set up — offer a catch-up or a new project instead.]', ''];
  const nudges: string[] = [];
  for (const p of data.projects) {
    lines.push(`PROJECT ${p.name} (id ${p.id}): ${fmtCounts(p.status_counts)}; $${p.total_committed.toFixed(2)} committed; specs: ${p.spec_categories.join(', ') || 'none'}`);
    const missing = SPEC_CATEGORIES.filter(c => !p.spec_categories.includes(c));
    if (missing.length) nudges.push(`${p.name} is missing specs for: ${missing.join(', ')} — worth capturing before the next search.`);
    if (p.stale_items.length) {
      nudges.push(`${p.name} has ${p.stale_items.length} ordered item(s) with no update in 7+ days: ${p.stale_items.map(s => s.description).join('; ')} — offer to check email or the vendor.`);
    }
    if (p.open_issues) nudges.push(`${p.name} has ${p.open_issues} item(s) flagged "issue" awaiting a decision.`);
    for (const e of p.recent_events.slice(0, 3)) {
      lines.push(`  recent: ${e.event} from ${e.vendor} at ${e.event_at}${e.raw_summary ? ` — ${e.raw_summary}` : ''}`);
    }
  }
  lines.push('');
  if (nudges.length) {
    lines.push('NUDGES (mention at most two, only when relevant to what the user asked):');
    for (const n of nudges.slice(0, 4)) lines.push(`- ${n}`);
  }
  return lines.join('\n');
}

export async function getStartedText(engine: Engine): Promise<string> {
  const data = await runOp(engine, 'get_dashboard_data', {}) as DashboardData;
  if (!data.projects || data.projects.length === 0) return newUserScript();
  return briefing(data);
}

/** Hint appended to an empty list_projects result. */
export const EMPTY_WORKSPACE_HINT =
  '[bomdb hint: empty workspace — this is a new user. Call get_started for the onboarding flow before doing anything else.]';
