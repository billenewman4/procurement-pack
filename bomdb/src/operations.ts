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
