import type { Engine } from './engine.ts';
import { isForwardMove, eventToStatus, STATUSES } from './status.ts';

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

export const operations: Operation[] = [
  {
    name: 'create_project',
    description: 'Create a new hardware project. Returns the project row.',
    params: { name: { type: 'string', description: 'Project name, e.g. "plant-waterer-v1"', required: true } },
    handler: async (engine, p) => {
      const rows = await engine.query(
        `INSERT INTO projects (name) VALUES ($1) RETURNING *`, [p.name]);
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
    description: 'Everything part-search loads before searching: the project, its specs, and its full BOM. Call this FIRST when working on a project.',
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
    name: 'upsert_line_item',
    description: 'Add a part to the BOM, or update it by id. New items default to status "needed". Fill chosen_because with which specs the part satisfies.',
    params: {
      id: { type: 'string', description: 'Omit to create' },
      project_id: { type: 'string', required: true },
      description: { type: 'string', required: true },
      part_number: { type: 'string' }, vendor: { type: 'string' },
      product_url: { type: 'string' }, qty: { type: 'number' },
      unit_price: { type: 'number' },
      status: { type: 'string', enum: STATUSES },
      source: { type: 'string', enum: ['manual', 'search', 'email'] },
      ordered_at: { type: 'string' }, eta: { type: 'string' },
      notes: { type: 'string' }, chosen_because: { type: 'string' },
    },
    handler: async (engine, p) => {
      if (p.id) {
        const rows = await engine.query(
          `UPDATE line_items SET
             description = COALESCE($2, description), part_number = COALESCE($3, part_number),
             vendor = COALESCE($4, vendor), product_url = COALESCE($5, product_url),
             qty = COALESCE($6, qty), unit_price = COALESCE($7, unit_price),
             source = COALESCE($8, source), ordered_at = COALESCE($9, ordered_at),
             eta = COALESCE($10, eta), notes = COALESCE($11, notes),
             chosen_because = COALESCE($12, chosen_because)
           WHERE id = $1 RETURNING *`,
          [p.id, p.description, p.part_number, p.vendor, p.product_url, p.qty,
           p.unit_price, p.source, p.ordered_at, p.eta, p.notes, p.chosen_because]);
        return rows[0] ?? { error: `line item ${p.id} not found` };
      }
      const rows = await engine.query(
        `INSERT INTO line_items
           (project_id, description, part_number, vendor, product_url, qty,
            unit_price, status, source, ordered_at, eta, notes, chosen_because)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7,COALESCE($8,'needed'),COALESCE($9,'manual'),$10,$11,$12,$13)
         RETURNING *`,
        [p.project_id, p.description, p.part_number, p.vendor, p.product_url, p.qty,
         p.unit_price, p.status, p.source, p.ordered_at, p.eta, p.notes, p.chosen_because]);
      return rows[0];
    },
  },
  {
    name: 'update_status',
    description: 'Move a line item through its lifecycle. Forward moves apply immediately. Backward moves and moves to/from "issue" are refused unless confirmed=true — ask the user before confirming.',
    params: {
      line_item_id: { type: 'string', required: true },
      status: { type: 'string', enum: STATUSES, required: true },
      confirmed: { type: 'boolean', description: 'Set true ONLY after the user explicitly approves a non-forward move' },
    },
    handler: async (engine, p) => {
      const [current] = await engine.query<{ status: string }>(
        `SELECT status FROM line_items WHERE id = $1`, [p.line_item_id]);
      if (!current) return { error: `line item ${p.line_item_id} not found` };
      if (!isForwardMove(current.status, p.status as string) && p.confirmed !== true) {
        return { error: `"${current.status}" → "${p.status}" is not a forward move; requires user confirmation (confirmed=true)` };
      }
      const rows = await engine.query(
        `UPDATE line_items SET status = $2,
           ordered_at = CASE WHEN $2 = 'ordered' AND ordered_at IS NULL THEN now() ELSE ordered_at END
         WHERE id = $1 RETURNING *`, [p.line_item_id, p.status]);
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
];

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
    return await op.handler(engine, params);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
