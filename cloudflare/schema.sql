-- Estoque da Padaria — Cloudflare D1 (SQLite)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity REAL NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS products_name_idx ON products(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('entrada', 'saida')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  balance_after REAL NOT NULL CHECK (balance_after >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'equipe',
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS movements_date_idx ON movements(created_at DESC);
CREATE INDEX IF NOT EXISTS movements_product_idx ON movements(product_id);

-- Rate limiting for the shared-password login. Only a keyed hash of the
-- Cloudflare client IP is stored; raw IP addresses are not persisted.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);

-- Append-only audit trail for product and stock operations. This table is
-- intentionally not linked by foreign key, so deletion cannot erase history.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'product_created',
    'product_updated',
    'stock_adjusted',
    'product_deleted',
    'movement_created'
  )),
  product_id TEXT,
  product_name TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'equipe',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_date_idx ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_product_idx ON audit_events(product_id);

-- Individual accounts (optional migration for an existing installation).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(username) BETWEEN 3 AND 40),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','operator','viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS users_active_role_idx
ON users(active, role);

CREATE INDEX IF NOT EXISTS users_username_idx
ON users(username COLLATE NOCASE);
