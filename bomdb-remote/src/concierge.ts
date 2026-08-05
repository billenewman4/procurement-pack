// The first-run concierge: server-generated guidance that arrives with the
// connector, before any skill is saved. get_started doubles as the context
// loader for returning users. All text here is written FOR CLAUDE to act on,
// not to be recited verbatim to the user.
import type { Engine } from '../../bomdb/src/engine.ts';
import { runOp } from '../../bomdb/src/operations.ts';

const RAW = 'https://raw.githubusercontent.com/billenewman4/procurement-pack/main';
const REPO = 'https://github.com/billenewman4/procurement-pack';

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
  one_offs: { description: string; vendor: string | null; status: string }[];
  vendors: { name: string; part_count: number; open_items: number; last_activity: string | null }[];
}

const SPEC_CATEGORIES = ['power', 'connectors', 'mechanical', 'constraints'];

const DIGEST_TASK_PROMPT = `Run my morning order digest. Unattended run — no questions, no clarifying
prompts.

1. Sweep Gmail for order lifecycle emails since the last sync (default 7
   days, widen if there's a gap), three passes: category:purchases first;
   then targeted sweeps for domains already in my vendor list
   (list_vendors); then a broad pass over the window — forwarded and
   oddly-routed vendor emails only show up there. Read only
   sender/subject/snippet until an email is classified as an order event;
   discard everything else.
2. Record each event with record_order_event. Statuses are researching →
   rfq → po_placed → delivered; shipped and issue are EVENTS, not
   statuses — the item stays po_placed and the tool auto-advances forward
   moves itself, never backward. Cover project items AND one-off
   master-list items (one-offs take line_item_id with no project_id).
   Quote order numbers and prices exactly, never infer. Leave
   line_item_id off anything below certain confidence — unmatched events
   need a project_id and are kept for manual reconciliation.
3. Report three short sections: UPDATED (item, old → new status, ETA),
   UNMATCHED (events needing my call), STALE (po_placed 7+ days with no
   event — use the stale_orders tool; worth a vendor nudge).
4. If nothing moved, say so in one line and stop.`;

function newUserScript(): string {
  return `[bomdb concierge — NEW USER, empty workspace]

This user just connected: no projects, no vendors, no parts. Guide them
conversationally — never a wall of instructions, and don't use our
internal words (MCP, connector, tool names) with them.

CONSENT RULE for this whole flow: only write what the user told you IN
THIS CONVERSATION. If you already know their vendors or projects from
memory or prior context, don't silently write them — say what you
remember in one line and ask ("Sounds like you buy from X — include
them?"). Confirmed memory counts as an answer; unconfirmed memory never
gets written.

STEP 0 — WELCOME, before anything else. One short message, then STOP
and wait. It must say, in your own warm words: (1) what this is — "I'm
going to set up your vendor CRM: every supplier you buy from and what
you've bought from them, built from your email"; (2) what will happen —
you'll scan the last 6 months of their email, show them everything you
found, and NOTHING is saved until they approve it; you'll also hand
them a few skills to save so dashboards and order tracking work in
every future chat; (3) end with: "Ready? Say continue." Do not fetch
skills, call tools, or ask anything else in this message.

STEP 1 — on their go-ahead ("continue" counts as email consent — the
welcome told them exactly what you'll scan). Two things, in this order,
in one turn:
  a. Skills first, so they have something to do while you dig: fetch
     ALL four files in one pass and present a save card for each —
       vendor-sweep — ${RAW}/skills/vendor-sweep/SKILL.md
       part-search — ${RAW}/skills/part-search/SKILL.md
       gmail-orders — ${RAW}/skills/gmail-orders/SKILL.md
       bom-dashboard — ${RAW}/skills/bom-dashboard/SKILL.md
     One line: "Save these while I go through your email — they take
     effect in your next chat." The full set lives at ${REPO} — that
     repo is the source of truth for what exists. Absence from your
     catalog is exactly why you package it, never a reason to skip;
     the only skip is a skill already active in this conversation.
     Never claim the skills step is done until they confirm Save.
  b. Then, same turn, run the sweep: follow the vendor-sweep skill you
     just fetched (its text is already in this conversation — use it
     even though the saved card activates next chat). Present findings
     as one compact table — vendors plus the parts bought from each —
     then STOP for their confirmation. Only after they confirm:
     upsert_vendor per vendor, then upsert_line_item per part (vendor
     name for auto-link, NO project_id — historical purchases are
     one-offs — status 'delivered', source 'email').
No Gmail access, or the sweep finds nothing? Offer exactly two
alternatives, one line each:
  - Paste or upload a parts list (Excel, CSV, messy text is fine) —
    you parse it, show the same table, confirm, write the same way.
  - Start clean — create a project whenever you're ready.

STEP 2 — TWO OFFERS, one line each, then stop:
  - Dashboard: say "show me my BOM" any time.
  - Weekday morning digest — order tracking on autopilot. On yes,
    create a scheduled task (weekdays, 8am their time) whose prompt is
    EXACTLY the text between the --- markers. If you cannot create
    scheduled tasks from this conversation, give them that text
    verbatim and say: "Open Tasks → new task → paste this → set it to
    weekday mornings." The task prompt must BE the digest
    instructions — never a request to set up a digest (a task run
    can't schedule other tasks).
   ---
   ${DIGEST_TASK_PROMPT}
   ---

DO NOT during onboarding: run part searches, quiz them about their
design or specs, or push them to create a project. They came
because supplier email is chaos; projects come when they're ready.
Afterward they can just talk: "I ordered the pump from McMaster",
"catch me up on my orders", "show me my BOM".`;
}

function fmtCounts(counts: Record<string, number>): string {
  const order = ['researching', 'rfq', 'po_placed', 'delivered'];
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
    if (p.open_issues) nudges.push(`${p.name} has ${p.open_issues} item(s) with an open issue (from order events) awaiting a decision.`);
    for (const e of p.recent_events.slice(0, 3)) {
      lines.push(`  recent: ${e.event} from ${e.vendor} at ${e.event_at}${e.raw_summary ? ` — ${e.raw_summary}` : ''}`);
    }
  }
  if (data.vendors.length) {
    lines.push(`VENDORS (${data.vendors.length}): ${data.vendors.map(v => `${v.name} (${v.part_count} part${v.part_count === 1 ? '' : 's'}${v.open_items ? `, ${v.open_items} open` : ''})`).join('; ')}`);
  }
  if (data.one_offs.length) {
    const open = data.one_offs.filter(o => o.status !== 'delivered').length;
    lines.push(`ONE-OFFS: ${data.one_offs.length} part(s) outside any project${open ? ` (${open} not yet delivered)` : ''}`);
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
  // A swept-but-projectless user (vendors/one-offs only) is set up, not new.
  const isNew = !data.projects?.length && !data.vendors?.length && !data.one_offs?.length;
  if (isNew) return newUserScript();
  return briefing(data);
}

/** Hint appended to an empty list_projects result. No projects may still
 *  mean a swept vendor list exists — get_started sorts new from returning. */
export const EMPTY_WORKSPACE_HINT =
  '[bomdb hint: no projects yet — call get_started before doing anything else; it returns onboarding for a new user or their vendor/one-off context.]';
