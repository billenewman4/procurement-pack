CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  sharing text NOT NULL DEFAULT 'hosted'
    CHECK (sharing IN ('local','hosted','community')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),          -- NULL in local/owner mode, like projects
  name text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',       -- email domains seen for this vendor
  contact_email text,
  website text,
  notes text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('email_sweep','manual','sourcing_agent')),
  active boolean NOT NULL DEFAULT true,
  sourcing_slug text,                         -- canonical slug from the sourcing agent (connect_vendor)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One vendor per (user, case-insensitive name). COALESCE folds local mode's
-- NULL user_id into a single namespace — a plain unique index would treat
-- every NULL as distinct and allow duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS vendors_user_lower_name
  ON vendors ((COALESCE(user_id::text, '')), lower(name));

CREATE TABLE IF NOT EXISTS project_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  spec text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);

CREATE TABLE IF NOT EXISTS line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = one-off master-list part (e.g. swept purchase history)
  user_id uuid REFERENCES users(id),          -- owner scope for one-offs; NULL in local/owner mode
  vendor_id uuid REFERENCES vendors(id),
  description text NOT NULL,
  part_number text,
  vendor text,                                -- back-compat display name; vendor_id is canonical
  product_url text,
  qty int NOT NULL DEFAULT 1,
  unit_price numeric(10,2),
  active boolean NOT NULL DEFAULT true,       -- false = replaced/hidden, kept for history
  status text NOT NULL DEFAULT 'cart'
    CHECK (status IN ('quoting','cart','ordered','delivered')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','search','email')),
  ordered_at timestamptz,
  eta date,
  notes text,
  chosen_because text,
  outcome text CHECK (outcome IN ('worked','failed','returned')),
  outcome_notes text
);

CREATE TABLE IF NOT EXISTS line_item_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id),
  vendor text NOT NULL,
  part_number text,
  product_url text,
  unit_price numeric(10,2),
  availability text,
  moq int,
  fit_notes text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','search','sourcing_quote')),
  quote_id text,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','selected','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid REFERENCES line_items(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = event on a one-off master-list item
  user_id uuid REFERENCES users(id),          -- owner scope for one-off events; NULL in local/owner mode
  vendor text NOT NULL,
  order_number text,
  event text NOT NULL
    CHECK (event IN ('confirmed','shipped','delivered','backordered','issue')),
  event_at timestamptz NOT NULL,
  tracking_url text,
  email_ref text,
  raw_summary text
);

-- ---- Hosted-mode isolation (scoped per-user roles) ----
-- The table owner (local PGLite, and the founders' master connection) bypasses
-- RLS entirely, so local mode is unaffected by everything below. Scoped roles
-- — provisioned by scripts/provision-user.ts — see and touch ONLY their own
-- rows. users.pg_role links a Postgres role name to an app user; every policy
-- scopes through it.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_options ENABLE ROW LEVEL SECURITY;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pg_role text UNIQUE;

-- Policies inline the role→user lookup rather than using a helper function:
-- a SECURITY DEFINER helper resolves current_user to the DEFINER, not the
-- caller, which silently breaks the scoping. Policy subqueries run with the
-- caller's rights, and users_self lets each role read exactly its own row —
-- so `SELECT id FROM users WHERE pg_role = current_user` is the caller's id.

DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR SELECT
  USING (pg_role = current_user);

DROP POLICY IF EXISTS projects_own ON projects;
CREATE POLICY projects_own ON projects FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE pg_role = current_user))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE pg_role = current_user));

DROP POLICY IF EXISTS vendors_own ON vendors;
CREATE POLICY vendors_own ON vendors FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE pg_role = current_user))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE pg_role = current_user));

DROP POLICY IF EXISTS project_specs_own ON project_specs;
CREATE POLICY project_specs_own ON project_specs FOR ALL
  USING (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user))
  WITH CHECK (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user));

-- One-off master-list items have no project; they scope through their own
-- user_id (stamped at insert), project items through the project as before.
DROP POLICY IF EXISTS line_items_own ON line_items;
CREATE POLICY line_items_own ON line_items FOR ALL
  USING (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user)
         OR (project_id IS NULL AND user_id IN (SELECT id FROM users WHERE pg_role = current_user)))
  WITH CHECK (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user)
         OR (project_id IS NULL AND user_id IN (SELECT id FROM users WHERE pg_role = current_user)));

-- Events on one-off items (no project) scope through their own user_id,
-- mirroring line_items_own above.
DROP POLICY IF EXISTS order_events_own ON order_events;
CREATE POLICY order_events_own ON order_events FOR ALL
  USING (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user)
         OR (project_id IS NULL AND user_id IN (SELECT id FROM users WHERE pg_role = current_user)))
  WITH CHECK (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user)
         OR (project_id IS NULL AND user_id IN (SELECT id FROM users WHERE pg_role = current_user)));

DROP POLICY IF EXISTS line_item_options_own ON line_item_options;
CREATE POLICY line_item_options_own ON line_item_options FOR ALL
  USING (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user))
  WITH CHECK (project_id IN (SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.pg_role = current_user));

DROP FUNCTION IF EXISTS current_app_user_id();
