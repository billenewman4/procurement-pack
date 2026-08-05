import type { Engine } from './engine.ts';
import { isForwardMove, eventToStatus, normalizeStatus, LEGACY_STATUS_MAP, STATUSES } from './status.ts';

export interface ParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  enum?: readonly string[];
  items?: ParamDef;
}

export interface Operation {
  name: string;
  description: string;
  params: Record<string, ParamDef>;
  handler: (engine: Engine, params: Record<string, unknown>) => Promise<unknown>;
}

/** Match an existing vendor by (user, case-insensitive name) or any
 *  overlapping email domain — name match wins when both hit different rows.
 *  Matches merge domains and fill blanks; no match inserts. Shared by
 *  upsert_vendor and every op that accepts a vendor name (upsert_line_item,
 *  select_option) so the vendor CRM stays the single source of truth. */
async function upsertVendorRow(
  engine: Engine,
  p: {
    name: string; domains?: unknown; contact_email?: unknown; website?: unknown;
    notes?: unknown; source?: unknown; active?: unknown;
  },
): Promise<Record<string, unknown>> {
  const name = p.name.trim();
  const domains = (Array.isArray(p.domains) ? p.domains : [])
    .map(d => String(d).trim().toLowerCase())
    .filter(Boolean);
  const [match] = await engine.query<{ id: string }>(
    `SELECT id FROM vendors
     WHERE user_id IS NOT DISTINCT FROM (SELECT id FROM users WHERE pg_role = current_user)
       AND (lower(name) = lower($1) OR domains && $2::text[])
     ORDER BY (lower(name) = lower($1)) DESC, created_at
     LIMIT 1`, [name, domains]);
  if (match) {
    const rows = await engine.query(
      `UPDATE vendors SET
         domains = (SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), '{}')
                    FROM unnest(vendors.domains || $2::text[]) AS d),
         contact_email = COALESCE($3, contact_email),
         website = COALESCE($4, website),
         notes = COALESCE($5, notes),
         active = COALESCE($6, active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [match.id, domains, p.contact_email, p.website, p.notes, p.active]);
    return rows[0];
  }
  const rows = await engine.query(
    `INSERT INTO vendors (user_id, name, domains, contact_email, website, notes, source, active)
     VALUES ((SELECT id FROM users WHERE pg_role = current_user),
             $1, $2::text[], $3, $4, $5, COALESCE($6, 'manual'), COALESCE($7, true))
     RETURNING *`,
    [name, domains, p.contact_email, p.website, p.notes, p.source, p.active]);
  return rows[0];
}

/** Vendor CRM rollup: each vendor with its linked parts (incl. inactive /
 *  historical ones — that history is the point), open item count, and last
 *  activity. Shared by list_vendors and get_dashboard_data. */
async function vendorRollup(engine: Engine, includeInactive: boolean): Promise<unknown[]> {
  const vendors = await engine.query<Record<string, unknown> & { id: string }>(
    `SELECT v.*,
            (SELECT count(*)::int FROM line_items li WHERE li.vendor_id = v.id) AS part_count,
            (SELECT count(*)::int FROM line_items li
             WHERE li.vendor_id = v.id AND li.active AND li.status <> 'delivered') AS open_items,
            GREATEST(v.updated_at,
              (SELECT max(oe.event_at) FROM order_events oe
               JOIN line_items li ON li.id = oe.line_item_id WHERE li.vendor_id = v.id),
              (SELECT max(li.ordered_at) FROM line_items li WHERE li.vendor_id = v.id)
            ) AS last_activity
     FROM vendors v
     WHERE $1::boolean OR v.active
     ORDER BY lower(v.name)`, [includeInactive]);
  const parts = await engine.query<Record<string, unknown> & { vendor_id: string }>(
    `SELECT vendor_id, id, project_id, description, part_number, qty, unit_price,
            status, active, ordered_at
     FROM line_items WHERE vendor_id IS NOT NULL
     ORDER BY ordered_at DESC NULLS LAST, description`);
  return vendors.map(v => ({ ...v, parts: parts.filter(x => x.vendor_id === v.id) }));
}

/** SQL fragment: does this line item have an unresolved issue? An issue-type
 *  order event with no later shipped/delivered event, on an undelivered item. */
const OPEN_ISSUE_SQL = `li.status <> 'delivered' AND EXISTS (
  SELECT 1 FROM order_events i
  WHERE i.line_item_id = li.id AND i.event = 'issue'
    AND NOT EXISTS (SELECT 1 FROM order_events r
                    WHERE r.line_item_id = li.id
                      AND r.event IN ('shipped','delivered')
                      AND r.event_at > i.event_at))`;

export const operations: Operation[] = [
  {
    name: 'create_project',
    description: 'Create a new hardware project. Returns the project row.',
    params: { name: { type: 'string', description: 'Project name, e.g. "plant-waterer-v1"', required: true } },
    handler: async (engine, p) => {
      // user_id resolves to the connected scoped role's app user (hosted
      // multi-user mode) or null for the owner/local connection.
      const rows = await engine.query(
        `INSERT INTO projects (name, user_id)
         VALUES ($1, (SELECT id FROM users WHERE pg_role = current_user))
         RETURNING *`, [p.name]);
      return rows[0];
    },
  },
  {
    name: 'list_projects',
    description: 'List all projects with line-item counts.',
    params: {},
    handler: (engine) => engine.query(
      `SELECT p.*, count(li.id)::int AS line_item_count
       FROM projects p LEFT JOIN line_items li ON li.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at`),
  },
  {
    name: 'rename_project',
    description: 'Rename a project. Returns the updated project row.',
    params: {
      project_id: { type: 'string', required: true },
      name: { type: 'string', description: 'New project name', required: true },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `UPDATE projects SET name = $2 WHERE id = $1 RETURNING *`,
        [p.project_id, p.name]);
      return rows[0] ?? { error: `project ${p.project_id} not found` };
    },
  },
  {
    name: 'upsert_spec',
    description: 'Set a project spec for a category (power, connectors, mechanical, constraints, ...). Replaces any existing spec for that category.',
    params: {
      project_id: { type: 'string', required: true },
      category: { type: 'string', description: 'e.g. power, connectors, mechanical, constraints', required: true },
      spec: { type: 'string', description: 'Freeform spec text', required: true },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `INSERT INTO project_specs (project_id, category, spec) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, category)
         DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
         RETURNING *`, [p.project_id, p.category, p.spec]);
      return rows[0];
    },
  },
  {
    name: 'get_project_context',
    description: 'Everything part-search loads before searching: the project, its specs, and its full BOM (incl. inactive items — check the active flag). Call this FIRST when working on a project.',
    params: { project_id: { type: 'string', required: true } },
    handler: async (engine, p) => {
      const [project] = await engine.query(`SELECT * FROM projects WHERE id = $1`, [p.project_id]);
      if (!project) return { error: `project ${p.project_id} not found` };
      const specs = await engine.query(
        `SELECT category, spec, updated_at FROM project_specs WHERE project_id = $1 ORDER BY category`, [p.project_id]);
      const line_items = await engine.query(
        `SELECT * FROM line_items WHERE project_id = $1 ORDER BY status, description`, [p.project_id]);
      return { project, specs, line_items };
    },
  },
  {
    name: 'upsert_vendor',
    description: 'Add or update a vendor in the user\'s vendor CRM. Matches an existing vendor by name (case-insensitive) or any overlapping email domain; matches merge domains and fill blank fields. Returns the vendor row.',
    params: {
      name: { type: 'string', description: 'Vendor name, e.g. "McMaster-Carr"', required: true },
      domains: { type: 'array', items: { type: 'string' }, description: 'Email domains seen for this vendor, e.g. ["mcmaster.com"]' },
      contact_email: { type: 'string' },
      website: { type: 'string' },
      notes: { type: 'string' },
      source: { type: 'string', enum: ['email_sweep', 'manual', 'sourcing_agent'] },
      active: { type: 'boolean', description: 'Set false to hide a vendor without deleting it' },
    },
    handler: (engine, p) => upsertVendorRow(engine, p as { name: string }),
  },
  {
    name: 'list_vendors',
    description: 'The user\'s vendor CRM: each vendor with the parts linked to it (incl. inactive/historical parts), open item count, and last activity date. Inactive vendors are hidden unless include_inactive=true.',
    params: {
      include_inactive: { type: 'boolean', description: 'Also list vendors marked inactive' },
    },
    handler: (engine, p) => vendorRollup(engine, p.include_inactive === true),
  },
  {
    name: 'upsert_line_item',
    description: 'Add a part to the BOM, or update it by id. Omit project_id for a one-off master-list part (e.g. swept purchase history) not tied to a project. Pass vendor_id for a known vendor, or a vendor NAME to auto-match/create one in the vendor CRM. New items default to status "researching". Status changes on existing items go through update_status, not here. Fill chosen_because with which specs the part satisfies.',
    params: {
      id: { type: 'string', description: 'Omit to create' },
      project_id: { type: 'string', description: 'Omit for a one-off master-list part' },
      description: { type: 'string', required: true },
      part_number: { type: 'string' },
      vendor: { type: 'string', description: 'Vendor name — auto-upserts into the vendor CRM' },
      vendor_id: { type: 'string', description: 'Known vendor id; wins over vendor name' },
      product_url: { type: 'string' }, qty: { type: 'number' },
      unit_price: { type: 'number' },
      status: { type: 'string', enum: STATUSES },
      source: { type: 'string', enum: ['manual', 'search', 'email'] },
      active: { type: 'boolean', description: 'false hides a replaced part without deleting it' },
      ordered_at: { type: 'string' }, eta: { type: 'string' },
      notes: { type: 'string' }, chosen_because: { type: 'string' },
    },
    handler: async (engine, p) => {
      let vendorId = (p.vendor_id as string | undefined) ?? null;
      let vendorName = (p.vendor as string | undefined) ?? null;
      if (vendorId) {
        const [v] = await engine.query<{ name: string }>(
          `SELECT name FROM vendors WHERE id = $1`, [vendorId]);
        if (!v) return { error: `vendor ${vendorId} not found` };
        vendorName = vendorName ?? v.name;
      } else if (typeof vendorName === 'string' && vendorName.trim() !== '') {
        const v = await upsertVendorRow(engine, { name: vendorName });
        vendorId = v.id as string;
        vendorName = v.name as string;
      }
      if (p.id) {
        if (p.status !== undefined && p.status !== null) {
          return { error: 'status cannot be changed via upsert_line_item — use update_status' };
        }
        // IS NOT DISTINCT FROM: one-off items match on project_id omitted/null.
        const rows = await engine.query(
          `UPDATE line_items SET
             description = COALESCE($2, description), part_number = COALESCE($3, part_number),
             vendor = COALESCE($4, vendor), vendor_id = COALESCE($5, vendor_id),
             product_url = COALESCE($6, product_url),
             qty = COALESCE($7, qty), unit_price = COALESCE($8, unit_price),
             source = COALESCE($9, source), active = COALESCE($10, active),
             ordered_at = COALESCE($11, ordered_at),
             eta = COALESCE($12, eta), notes = COALESCE($13, notes),
             chosen_because = COALESCE($14, chosen_because)
           WHERE id = $1 AND project_id IS NOT DISTINCT FROM $15 RETURNING *`,
          [p.id, p.description, p.part_number, vendorName, vendorId, p.product_url, p.qty,
           p.unit_price, p.source, p.active, p.ordered_at, p.eta, p.notes, p.chosen_because,
           p.project_id ?? null]);
        return rows[0] ?? { error: `line item ${p.id} not found in ${p.project_id ? `project ${p.project_id}` : 'the one-off master list'}` };
      }
      // user_id: inherit the project's owner, else the connected scoped user
      // (one-offs scope through it under RLS); null for the owner/local connection.
      const rows = await engine.query(
        `INSERT INTO line_items
           (project_id, user_id, description, part_number, vendor, vendor_id, product_url,
            qty, unit_price, status, source, active, ordered_at, eta, notes, chosen_because)
         VALUES ($1,
                 COALESCE((SELECT user_id FROM projects WHERE id = $1),
                          (SELECT id FROM users WHERE pg_role = current_user)),
                 $2,$3,$4,$5,$6,COALESCE($7,1),$8,COALESCE($9,'researching'),
                 COALESCE($10,'manual'),COALESCE($11,true),$12,$13,$14,$15)
         RETURNING *`,
        [p.project_id ?? null, p.description, p.part_number, vendorName, vendorId,
         p.product_url, p.qty, p.unit_price, p.status, p.source, p.active,
         p.ordered_at, p.eta, p.notes, p.chosen_because]);
      return rows[0];
    },
  },
  {
    name: 'set_item_active',
    description: 'Show or hide a line item without deleting it: active=false when a part is replaced or no longer needed. Hidden items keep their history and vendor link but drop out of the dashboard and rollups.',
    params: {
      line_item_id: { type: 'string', required: true },
      active: { type: 'boolean', required: true },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `UPDATE line_items SET active = $2 WHERE id = $1 RETURNING *`,
        [p.line_item_id, p.active]);
      return rows[0] ?? { error: `line item ${p.line_item_id} not found` };
    },
  },
  {
    name: 'update_status',
    description: 'Move a line item through its lifecycle: researching → rfq → po_placed → delivered. Shipping and issues are NOT statuses — record those with record_order_event; the dashboard derives shipped badges and open issues from events. Forward moves apply immediately. Backward moves are refused unless confirmed=true — ask the user before confirming.',
    params: {
      line_item_id: { type: 'string', required: true },
      status: { type: 'string', enum: STATUSES, required: true },
      confirmed: { type: 'boolean', description: 'Set true ONLY after the user explicitly approves a non-forward move' },
    },
    handler: async (engine, p) => {
      const requested = p.status as string;
      if (requested === 'shipped' || requested === 'issue') {
        return { error: `"${requested}" is not a status — record it with record_order_event (event: "${requested}"); the item stays "po_placed" and the dashboard derives shipped/issue state from order events` };
      }
      if (!(STATUSES as readonly string[]).includes(requested)) {
        const renamed = LEGACY_STATUS_MAP[requested];
        return { error: renamed
          ? `"${requested}" was renamed — use "${renamed}" (statuses are now: ${STATUSES.join(', ')})`
          : `unknown status "${requested}" — one of: ${STATUSES.join(', ')}` };
      }
      const [current] = await engine.query<{ status: string }>(
        `SELECT status FROM line_items WHERE id = $1`, [p.line_item_id]);
      if (!current) return { error: `line item ${p.line_item_id} not found` };
      if (!isForwardMove(current.status, requested) && p.confirmed !== true) {
        return { error: `"${current.status}" → "${requested}" is not a forward move; requires user confirmation (confirmed=true)` };
      }
      const rows = await engine.query(
        `UPDATE line_items SET status = $2,
           ordered_at = CASE WHEN $2 = 'po_placed' AND ordered_at IS NULL THEN now() ELSE ordered_at END
         WHERE id = $1 RETURNING *`, [p.line_item_id, requested]);
      return rows[0];
    },
  },
  {
    name: 'set_outcome',
    description: 'Record how a part worked out (worked/failed/returned) and why. Fill this whenever the user reports a part succeeded, failed, or was returned — it is the most valuable data in the system.',
    params: {
      line_item_id: { type: 'string', required: true },
      outcome: { type: 'string', enum: ['worked', 'failed', 'returned'], required: true },
      outcome_notes: { type: 'string', description: 'Why — e.g. "browned out under pump inrush"' },
    },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `UPDATE line_items SET outcome = $2, outcome_notes = COALESCE($3, outcome_notes)
         WHERE id = $1 RETURNING *`, [p.line_item_id, p.outcome, p.outcome_notes]);
      return rows[0] ?? { error: `line item ${p.line_item_id} not found` };
    },
  },
  {
    name: 'record_order_event',
    description: 'Append an order lifecycle event from an email (gmail-orders emits these). This is the ONLY home of shipped/issue — they are events, not statuses. Auto-advances the matched line item when the event implies a forward move (confirmed/shipped → po_placed, delivered → delivered); never moves backward — anomalies come back flagged for the user. Unmatched events (no line_item_id) are kept for manual reconciliation.',
    params: {
      project_id: { type: 'string', required: true },
      line_item_id: { type: 'string', description: 'Omit if unmatched' },
      vendor: { type: 'string', required: true },
      order_number: { type: 'string' },
      event: { type: 'string', enum: ['confirmed', 'shipped', 'delivered', 'backordered', 'issue'], required: true },
      event_at: { type: 'string', description: 'ISO timestamp from the email', required: true },
      tracking_url: { type: 'string' },
      email_ref: { type: 'string', description: 'Gmail message id' },
      raw_summary: { type: 'string', description: 'One line. Never full bodies.', required: true },
    },
    handler: async (engine, p) => {
      let line_item_status: string | null = null;
      let flag: string | undefined;
      // Match the line item within the given project only — a valid id from
      // another project must never be advanced (or linked) from here.
      let matched: { status: string } | undefined;
      let lineItemId: unknown = p.line_item_id ?? null;
      if (p.line_item_id) {
        [matched] = await engine.query<{ status: string }>(
          `SELECT status FROM line_items WHERE id = $1 AND project_id = $2`,
          [p.line_item_id, p.project_id]);
        if (!matched) {
          lineItemId = null;
          flag = `line item ${p.line_item_id} not found in project ${p.project_id} — event stored unmatched for manual reconciliation`;
        }
      }
      const [ev] = await engine.query(
        `INSERT INTO order_events (line_item_id, project_id, vendor, order_number, event, event_at, tracking_url, email_ref, raw_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [lineItemId, p.project_id, p.vendor, p.order_number ?? null,
         p.event, p.event_at, p.tracking_url ?? null, p.email_ref ?? null, p.raw_summary]);
      if (matched) {
        const implied = eventToStatus(p.event as string);
        if (implied && isForwardMove(matched.status, implied)) {
          const [updated] = await engine.query<{ status: string }>(
            `UPDATE line_items SET status = $2 WHERE id = $1 AND project_id = $3 RETURNING status`,
            [p.line_item_id, implied, p.project_id]);
          line_item_status = updated.status;
        } else {
          line_item_status = matched.status;
          if (implied !== matched.status) {
            flag = `event "${p.event}" does not forward-advance item in status "${matched.status}" — surface to the user`;
          }
        }
      }
      return { ...(ev as object), line_item_status, ...(flag ? { flag } : {}) };
    },
  },
  {
    name: 'stale_orders',
    description: 'Line items stuck in "po_placed" with no order event in the last N days (default 7) — candidates for a vendor nudge.',
    params: {
      project_id: { type: 'string', description: 'Omit for all projects' },
      days: { type: 'number' },
    },
    handler: (engine, p) => engine.query(
      `SELECT li.*, p.name AS project_name,
              (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id) AS last_event_at
       FROM line_items li LEFT JOIN projects p ON p.id = li.project_id
       WHERE li.status = 'po_placed' AND li.active
         AND ($1::uuid IS NULL OR li.project_id = $1)
         -- sentinel: no events and no ordered_at means we know nothing recent — always stale
         AND COALESCE(
               (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id),
               li.ordered_at, now() - interval '100 years')
             < now() - make_interval(days => COALESCE($2::int, 7))
       ORDER BY li.ordered_at`,
      [p.project_id ?? null, p.days ?? null]),
  },
  {
    name: 'add_line_item_option',
    description: 'Store a vendor option (candidate) for a line item — call after part search or a sourcing quote so alternatives persist and show on the dashboard. Store the top 2-3, not just the favorite. Pass vendor_id when the vendor is already in the CRM; candidates never auto-create vendors (selection does).',
    params: {
      line_item_id: { type: 'string', required: true },
      project_id: { type: 'string', required: true },
      vendor: { type: 'string', required: true },
      vendor_id: { type: 'string', description: 'Known vendor id, if already in the vendor CRM' },
      part_number: { type: 'string' },
      product_url: { type: 'string' },
      unit_price: { type: 'number' },
      availability: { type: 'string', description: 'e.g. "in stock", "3-week lead", "RFQ only"' },
      moq: { type: 'number', description: 'Minimum order quantity, if any' },
      fit_notes: { type: 'string', description: 'One line: why this option / the tradeoff' },
      source: { type: 'string', enum: ['manual', 'search', 'sourcing_quote'] },
      quote_id: { type: 'string', description: 'Sourcing quote id when source is sourcing_quote' },
    },
    handler: async (engine, p) => {
      const [item] = await engine.query(
        `SELECT id FROM line_items WHERE id = $1 AND project_id = $2`,
        [p.line_item_id, p.project_id]);
      if (!item) return { error: `line item ${p.line_item_id} not found in project ${p.project_id}` };
      const rows = await engine.query(
        `INSERT INTO line_item_options
           (line_item_id, project_id, vendor, vendor_id, part_number, product_url, unit_price,
            availability, moq, fit_notes, source, quote_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'manual'),$12) RETURNING *`,
        [p.line_item_id, p.project_id, p.vendor, p.vendor_id, p.part_number, p.product_url,
         p.unit_price, p.availability, p.moq, p.fit_notes, p.source, p.quote_id]);
      return rows[0];
    },
  },
  {
    name: 'list_options',
    description: 'Vendor options stored for a line item, oldest first.',
    params: { line_item_id: { type: 'string', required: true } },
    handler: (engine, p) => engine.query(
      `SELECT * FROM line_item_options WHERE line_item_id = $1 ORDER BY created_at`,
      [p.line_item_id]),
  },
  {
    name: 'select_option',
    description: "Choose a vendor option: stamps its vendor (incl. the vendor CRM link), part, url, and price onto the line item, marks it selected and its siblings rejected. Use when the user picks from the dashboard's option cards or in conversation.",
    params: {
      option_id: { type: 'string', required: true },
      project_id: { type: 'string', required: true },
    },
    handler: async (engine, p) => {
      const [opt] = await engine.query<Record<string, unknown>>(
        `UPDATE line_item_options SET status = 'selected'
         WHERE id = $1 AND project_id = $2 RETURNING *`,
        [p.option_id, p.project_id]);
      if (!opt) return { error: `option ${p.option_id} not found in project ${p.project_id}` };
      await engine.query(
        `UPDATE line_item_options SET status = 'rejected'
         WHERE line_item_id = $1 AND id <> $2 AND status <> 'rejected'`,
        [opt.line_item_id, p.option_id]);
      // Selection commits to the vendor: link the option's CRM vendor, or
      // match/create one from its name so the CRM stays complete.
      let vendorId = opt.vendor_id as string | null;
      let vendorName = opt.vendor as string;
      if (!vendorId) {
        const v = await upsertVendorRow(engine, { name: vendorName });
        vendorId = v.id as string;
        vendorName = v.name as string;
      }
      const [line_item] = await engine.query(
        `UPDATE line_items SET
           vendor = $2, vendor_id = $3,
           part_number = COALESCE($4, part_number),
           product_url = COALESCE($5, product_url),
           unit_price = COALESCE($6, unit_price)
         WHERE id = $1 RETURNING *`,
        [opt.line_item_id, vendorName, vendorId, opt.part_number, opt.product_url, opt.unit_price]);
      return { option: opt, line_item };
    },
  },
  {
    name: 'get_dashboard_data',
    description: 'Aggregated BOM dashboard data: per-project status buckets (Researching = researching+rfq, Ordered = po_placed with a shipped badge derived from order events, Delivered), committed spend, spec coverage, open issues (derived from unresolved issue events), stale ordered items, recent order events, plus the vendor CRM rollup and one-off master-list parts. Inactive items are excluded. Call this before rendering a BOM dashboard or status overview.',
    params: { project_id: { type: 'string', description: 'Omit for all projects' } },
    handler: async (engine, p) => {
      const projects = await engine.query<{ id: string; name: string; created_at: string }>(
        `SELECT id, name, created_at FROM projects
         WHERE ($1::uuid IS NULL OR id = $1) ORDER BY created_at`,
        [p.project_id ?? null]);
      const out = [];
      for (const proj of projects) {
        const specs = await engine.query<{ category: string }>(
          `SELECT category FROM project_specs WHERE project_id = $1 ORDER BY category`, [proj.id]);
        const counts = await engine.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM line_items
           WHERE project_id = $1 AND active GROUP BY status`, [proj.id]);
        const [{ committed }] = await engine.query<{ committed: number }>(
          `SELECT COALESCE(sum(qty * unit_price), 0)::float AS committed
           FROM line_items WHERE project_id = $1 AND active AND status IN ('po_placed','delivered')`, [proj.id]);
        const stale = await engine.query(
          `SELECT li.id, li.description, li.vendor, li.ordered_at,
                  (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id) AS last_event_at
           FROM line_items li
           WHERE li.project_id = $1 AND li.status = 'po_placed' AND li.active
             AND COALESCE(
                   (SELECT max(oe.event_at) FROM order_events oe WHERE oe.line_item_id = li.id),
                   li.ordered_at, now() - interval '100 years')
                 < now() - interval '7 days'
           ORDER BY li.ordered_at`, [proj.id]);
        const recent_events = await engine.query(
          `SELECT event, vendor, order_number, event_at, raw_summary
           FROM order_events WHERE project_id = $1 ORDER BY event_at DESC LIMIT 5`, [proj.id]);
        const items = await engine.query<Record<string, unknown> & { id: string; open_issue: boolean }>(
          `SELECT li.*,
                  EXISTS (SELECT 1 FROM order_events oe
                          WHERE oe.line_item_id = li.id AND oe.event = 'shipped') AS shipped,
                  (${OPEN_ISSUE_SQL}) AS open_issue
           FROM line_items li WHERE li.project_id = $1 AND li.active
           ORDER BY li.status, li.description`, [proj.id]);
        const options = await engine.query<Record<string, unknown> & { line_item_id: string }>(
          `SELECT * FROM line_item_options
           WHERE project_id = $1 AND status <> 'rejected' ORDER BY created_at`, [proj.id]);
        const itemsWithOptions = items.map(li => ({
          ...li,
          options: options.filter(o => o.line_item_id === li.id),
        }));
        const statusCounts = Object.fromEntries(counts.map(c => [c.status, c.n]));
        out.push({
          id: proj.id,
          name: proj.name,
          created_at: proj.created_at,
          spec_categories: specs.map(s => s.category),
          status_counts: statusCounts,
          buckets: {
            researching: (statusCounts.researching ?? 0) + (statusCounts.rfq ?? 0),
            ordered: statusCounts.po_placed ?? 0,
            delivered: statusCounts.delivered ?? 0,
          },
          total_committed: Number(committed),
          open_issues: items.filter(li => li.open_issue).length,
          stale_items: stale,
          recent_events,
          items: itemsWithOptions,
        });
      }
      // One-off master-list parts (no project) and the vendor CRM ride along
      // so the dashboard renders vendors + BOM from a single call.
      const one_offs = await engine.query(
        `SELECT li.*,
                EXISTS (SELECT 1 FROM order_events oe
                        WHERE oe.line_item_id = li.id AND oe.event = 'shipped') AS shipped,
                (${OPEN_ISSUE_SQL}) AS open_issue
         FROM line_items li WHERE li.project_id IS NULL AND li.active
         ORDER BY li.status, li.description`);
      const vendors = await vendorRollup(engine, false);
      return { projects: out, one_offs, vendors };
    },
  },
  {
    name: 'export_json',
    description: 'Export a project in the bom.json interchange shape (store/README.md). last_email_sync is derived from max(order_events.event_at).',
    params: { project_id: { type: 'string', required: true } },
    handler: async (engine, p) => {
      const [project] = await engine.query(`SELECT * FROM projects WHERE id = $1`, [p.project_id]);
      if (!project) return { error: `project ${p.project_id} not found` };
      const specs = await engine.query(`SELECT * FROM project_specs WHERE project_id = $1 ORDER BY category`, [p.project_id]);
      const line_items = await engine.query(`SELECT * FROM line_items WHERE project_id = $1`, [p.project_id]);
      const order_events = await engine.query(`SELECT * FROM order_events WHERE project_id = $1 ORDER BY event_at`, [p.project_id]);
      const [sync] = await engine.query<{ max: unknown }>(
        `SELECT max(event_at) AS max FROM order_events WHERE project_id = $1`, [p.project_id]);
      return {
        project, specs, line_items, order_events,
        last_email_sync: sync?.max ?? null,
      };
    },
  },
  {
    name: 'import_json',
    description: 'Import a bom.json (store/README.md shape) as a new project. Short ids are remapped to uuids; line_item↔order_event links are preserved. Legacy statuses (needed/ordered/shipped/issue) are remapped to the current lifecycle.',
    params: { bom: { type: 'object', description: 'Parsed bom.json contents', required: true } },
    handler: async (engine, p) => {
      const bom = p.bom as {
        project: { name: string };
        specs?: { category: string; spec: string }[];
        line_items?: Record<string, unknown>[];
        order_events?: Record<string, unknown>[];
      };
      const [project] = await engine.query<{ id: string }>(
        `INSERT INTO projects (name) VALUES ($1) RETURNING id`, [bom.project.name]);
      for (const s of bom.specs ?? []) {
        await engine.query(
          `INSERT INTO project_specs (project_id, category, spec) VALUES ($1,$2,$3)
           ON CONFLICT (project_id, category) DO UPDATE SET spec = EXCLUDED.spec`,
          [project.id, s.category, s.spec]);
      }
      const idMap = new Map<string, string>();
      for (const li of bom.line_items ?? []) {
        const [row] = await engine.query<{ id: string }>(
          `INSERT INTO line_items (project_id, description, part_number, vendor, product_url, qty, unit_price, status, source, active, ordered_at, eta, notes, chosen_because, outcome, outcome_notes)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7,COALESCE($8,'researching'),COALESCE($9,'manual'),COALESCE($10,true),$11,$12,$13,$14,$15,$16) RETURNING id`,
          [project.id, li.description, li.part_number ?? null, li.vendor ?? null,
           li.product_url ?? null, li.qty ?? null, li.unit_price ?? null,
           typeof li.status === 'string' ? normalizeStatus(li.status) : null,
           li.source ?? null, li.active ?? null, li.ordered_at ?? null,
           li.eta ?? null, li.notes ?? null, li.chosen_because ?? null,
           li.outcome ?? null, li.outcome_notes ?? null]);
        if (typeof li.id === 'string') idMap.set(li.id, row.id);
      }
      for (const oe of bom.order_events ?? []) {
        await engine.query(
          `INSERT INTO order_events (line_item_id, project_id, vendor, order_number, event, event_at, tracking_url, email_ref, raw_summary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [typeof oe.line_item_id === 'string' ? idMap.get(oe.line_item_id) ?? null : null,
           project.id, oe.vendor, oe.order_number ?? null, oe.event, oe.event_at,
           oe.tracking_url ?? null, oe.email_ref ?? null, oe.raw_summary ?? null]);
      }
      return { project_id: project.id, line_items_imported: (bom.line_items ?? []).length };
    },
  },
];

/** Columns whose driver representation isn't clean JSON. PGLite/postgres hand
 *  back timestamptz/date columns as Date objects and numeric columns as
 *  strings; `eta` is a SQL `date`, so it should read "2026-08-02", not a
 *  midnight-UTC timestamp. */
export const NUMERIC_KEYS = new Set(['unit_price']);
export const DATE_ONLY_KEYS = new Set(['eta']);

/** Deep-coerce an op result to clean JSON for MCP output: Dates → ISO strings
 *  (date-only for DATE_ONLY_KEYS), NUMERIC_KEYS' numeric strings → numbers.
 *  Applied to every op result by runOp. */
function toJsonResult(value: unknown, key?: string): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return key !== undefined && DATE_ONLY_KEYS.has(key) ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map(v => toJsonResult(v));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toJsonResult(v, k)]),
    );
  }
  if (key !== undefined && NUMERIC_KEYS.has(key) && typeof value === 'string') {
    return Number(value);
  }
  return value;
}

/** Validate params against the op's declared schema; dispatch; never throw. */
export async function runOp(
  engine: Engine, name: string, params: Record<string, unknown>,
): Promise<unknown> {
  const op = operations.find(o => o.name === name);
  if (!op) return { error: `unknown operation: ${name}` };
  for (const [key, def] of Object.entries(op.params)) {
    if (def.required && (params[key] === undefined || params[key] === null || params[key] === '')) {
      return { error: `missing required param: ${key}` };
    }
  }
  try {
    return toJsonResult(await op.handler(engine, params));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
