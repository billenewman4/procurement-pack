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
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description text NOT NULL,
  part_number text,
  vendor text,
  product_url text,
  qty int NOT NULL DEFAULT 1,
  unit_price numeric(10,2),
  status text NOT NULL DEFAULT 'needed'
    CHECK (status IN ('needed','researching','ordered','shipped','delivered','issue')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','search','email')),
  ordered_at timestamptz,
  eta date,
  notes text,
  chosen_because text,
  outcome text CHECK (outcome IN ('worked','failed','returned')),
  outcome_notes text
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid REFERENCES line_items(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  order_number text,
  event text NOT NULL
    CHECK (event IN ('confirmed','shipped','delivered','backordered','issue')),
  event_at timestamptz NOT NULL,
  tracking_url text,
  email_ref text,
  raw_summary text
);
