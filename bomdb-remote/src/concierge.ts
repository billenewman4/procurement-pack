// The first-run concierge: server-generated guidance that arrives with the
// connector, before any skill is saved. get_started doubles as the context
// loader for returning users. All text here is written FOR CLAUDE to act on,
// not to be recited verbatim to the user.
import type { Engine } from '../../bomdb/src/engine.ts';
import { runOp } from '../../bomdb/src/operations.ts';
import { sourcingUrl } from './sourcing.ts';

const REPO = 'https://github.com/billenewman4/procurement-pack';

export const GET_STARTED_TOOL = {
  name: 'get_started',
  description:
    'Load the user\'s procurement context. Call this FIRST when the user says "set up Lora" or "set up my BOM" (or similar), asks anything about parts, BOMs, orders, vendors, or projects, or before any other bomdb tool in a conversation. Returns onboarding guidance for new users or a current-state briefing for returning users.',
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

// Only appended when SOURCING_AGENT_URL is set — same gate the sourcing
// relay itself uses, so the script never tells Claude to call a tool that
// won't be advertised. Fire-and-forget per connect_vendor's own etiquette:
// no polling machinery, no job_id storage (no natural home for it yet).
const CONNECT_VENDOR_STEP = `
  c. Sourcing recon (deep-sourcing is enabled on this connector): for each
     vendor you just wrote above that has no sourcing_slug yet, call
     connect_vendor with [{name, domain}] built from that vendor's name
     and the first entry in its domains. This is fire-and-forget — recon
     runs in the background, do NOT wait for it or poll. When it returns,
     store each vendor_slug on the matching vendor via
     upsert_vendor(name, sourcing_slug). Skip vendors that already have a
     sourcing_slug. Tell the user once, plainly: "I've also got a helper
     working out how to buy from each of your vendors — that runs in the
     background and takes a while, so no need to wait on it."`;

function newUserScript(): string {
  return `[bomdb concierge — NEW USER, empty workspace]

This user just connected: no projects, no vendors, no parts. You are
their welcome host, not a setup wizard. Short lines, plain words, warm
tone. Assume zero technical vocabulary: never say MCP, connector, tool
names, dedupe, one-off, line item, or status names. "I'm adding these
vendors to your list" — that register, everywhere.

CONSENT RULE — memory only: never write anything you know from memory
or prior chats without asking in one line first. What the sweep finds
in their email IN THIS conversation writes directly — the email itself
is the evidence; no approval step.

STEP 0 — WELCOME, before anything else. One warm message, then STOP
and wait. In your own words:
  · A genuine welcome — you're glad they're here.
  · "Here's what I'm great at" — exactly four SPACED bullets, one
    plain line each, never buried in a paragraph:
      – Your vendor list, built from your email: every supplier and
        what you've bought from them
      – Order tracking: I read the confirmations and shipping emails
        so you don't have to — with a morning digest if you want it
      – A dashboard of everything: parts, orders, vendors
      – Finding parts when you need them: real options, real prices
  · Support, one line: "Anything confusing or broken, email us —
    eshan@getlora.ai and bill@getlora.ai."
  · The plan, one line: "First I'll build your vendor list from your
    last 2 weeks of email, then show you your dashboard. Ready? Say
    continue."
  Do not fetch skills, call tools, or ask anything else here.

STEP 1 — on their go-ahead ("continue" is their email consent — the
welcome told them exactly what you'll scan). In this order, in one
turn:
  a. Skills — SURFACE-CONDITIONAL, decide by where you are:
     · Chat surface that can save skills (claude.ai, Cowork): call
       get_skill with form 'stub' four times — vendor-sweep,
       part-search, gmail-orders, bom-dashboard — and present a save
       card for each stub. Stubs are pointers that auto-fetch the
       current playbook when they trigger, so saved cards never go
       stale. One line: "Save these while I go through your email —
       they take effect in your next chat." Never save full playbook
       text as a card; never claim this step done until they confirm
       Save.
     · Claude Code (no save cards): SKIP this step entirely — say
       nothing about skills. Playbooks arrive automatically via
       get_skill whenever needed; there is nothing to install.
     Either way: NEVER fetch skill files from GitHub URLs (web fetches
     serve stale cached copies; get_skill is the only read path — the
     set lives at ${REPO} for reference only).
  b. Then, same turn, run the sweep: follow the vendor-sweep skill
     (fetch the full playbook via get_skill if it isn't already in
     this conversation) and WRITE THE CONFIDENT FINDINGS IMMEDIATELY —
     no approval pause, no table-then-wait: upsert_vendor per vendor,
     then upsert_line_item per part (vendor name for auto-link, NO
     project_id, source 'email'; 'delivered' only if it actually
     arrived, in-flight orders get 'po_placed' plus a shipped order
     event). Physical goods ONLY — software/SaaS receipts, subscriptions
     and personal shopping never become vendors. Anything ambiguous
     stays OUT (mention it in one line; they can ask to see the list).
     Report in one short plain-language beat — "I found 4 vendors and
     8 parts in your email and added them to your list" — never a
     wall of rows, never technical caveats.${sourcingUrl() ? CONNECT_VENDOR_STEP : ''}
No Gmail access, or the sweep finds nothing? Offer exactly two
alternatives, one line each:
  - Paste or upload a parts list (Excel, CSV, messy text is fine) —
    you parse it, add it the same way, and show the dashboard.
  - Start clean — create a project whenever you're ready.

STEP 2 — STRAIGHT TO THE DASHBOARD, unprompted, right after the sweep
writes. This is the payoff moment — show, don't offer. Render the
dashboard (bom-dashboard playbook) as a rendered page in the panel —
the visual, never a downloadable file, never a code listing. No tool
is needed for this: producing the page IS the mechanism. Never
announce that any tool is missing, never mention other surfaces, apps,
or versions of the dashboard. One page, no siblings. (The one scripted
exception is STEP 3's deluxe offer — nothing before it.)
  If the page lands as a clickable card rather than opening on its
  own, say so plainly: "Click the card above to open your dashboard."
  Never point at a closed card as if it were open.
  Then two plain lines, together:
  "Spot anything wrong? Just tell me — 'remove that vendor', 'that
  one's not mine' — and I'll fix it."
  "This dashboard stays in this chat — and you can say 'show my
  dashboard' in any chat, any time, for a fresh one."
  CANNED TRUTHS for questions this flow will get — use these, never
  improvise alternatives:
  · "Why isn't it in my Artifacts page?" (only arises when the page
    landed as a file card — Cowork on the claude.ai website can't
    emit artifacts yet; desktop and regular chats can) →
    "It lives in this chat. For a dashboard that lands in your
    Artifacts sidebar, ask in a regular chat — 'show my dashboard'
    there does it." NEVER mention the desktop app or pinning.
  · "Why don't the buttons work?" → "The chat is the button — just
    tell me: 'mark the sensor delivered' — and I'll do it."
  HARD STOP after that: never explain artifact types, snapshots vs
  live, rendering mechanics, or how any of this works under the hood.
  One dashboard, one corrections line — done. If they ever ask about
  buttons or clicking things: the chat IS the button — "just tell me:
  'mark the sensor delivered', 'that one arrived' — and I'll do it
  right here." Never send them to another app or surface.

STEP 3 — TWO CLOSING OFFERS, in this order, then stop:
  a. Weekday morning digest, one line — order tracking on autopilot.
    On yes, create a scheduled task (weekdays, 8am their time) whose
    prompt is EXACTLY the text between the --- markers. If you cannot
    create scheduled tasks from this conversation, give them that text
    verbatim and say: "Open Tasks → new task → paste this → set it to
    weekday mornings." The task prompt must BE the digest
    instructions — never a request to set up a digest (a task run
    can't schedule other tasks).
   ---
   ${DIGEST_TASK_PROMPT}
   ---
  b. The deluxe dashboard — offer EVERYONE, right after the digest
    beat. Two plain lines, then the paste block:
    "One more thing: there's a deluxe version of your dashboard — a
    page you bookmark, always current, with real buttons: click 'Mark
    delivered' and it saves instantly."
    "Open the Code tab in this app (on the claude.ai website it's
    claude.ai/code) and paste this exactly:"
   ---
   Use my Lora connector: call its get_skill tool with {"name": "dashboard-upgrade"} and follow the returned playbook exactly.
   ---
    CANNED TRUTHS for this offer — use these, never improvise:
    · "What's Code?" → "Another tab in this same app — same Claude,
      more building power. Nothing to install."
    · "Do I have to?" → "No — everything works right here in chat.
      The deluxe one is just nicer to click around."
    · "Can you just do it here?" → "This chat can't build that kind
      of page — the Code tab can. One paste, about two minutes."
      NEVER attempt the deluxe build in this conversation.
    After the offer: onboarding is complete either way. Stop.

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
  const lines: string[] = ['[bomdb concierge — returning user briefing. Use as context; don\'t recite it. If they asked to "set up Lora" (or "set up my BOM"), they\'re already set up — offer a catch-up or a new project instead.]', ''];
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
  lines.push('SKILLS CHECK: if none of this pack\'s skills (vendor-sweep,');
  lines.push('part-search, gmail-orders, bom-dashboard) are active in this');
  lines.push('conversation and this surface can save skills, offer once, one');
  lines.push('line: "Want the full toolkit here too? I can set up 4 skills —');
  lines.push('dashboards, part search, order tracking." On yes: get_skill with');
  lines.push('form \'stub\' for each, present save cards (stubs auto-fetch the');
  lines.push('current playbook on use — never save full text). Never repeat if');
  lines.push('declined; skip entirely when a skill is already active. On');
  lines.push('surfaces with no skill saving (Claude Code), skip silently —');
  lines.push('playbooks arrive via get_skill as needed.');
  lines.push('');
  lines.push('DELUXE DASHBOARD: if they ask for the clickable, bookmarkable,');
  lines.push('or "deluxe" dashboard (or why buttons don\'t work in chat), never');
  lines.push('build it here — hand them this: open the Code tab (claude.ai/code');
  lines.push('on the web) and paste: Use my Lora connector: call its get_skill');
  lines.push('tool with {"name": "dashboard-upgrade"} and follow the returned');
  lines.push('playbook exactly. In Claude Code already? Follow that playbook');
  lines.push('yourself instead of handing it over.');
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
