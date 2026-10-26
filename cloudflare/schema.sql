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
