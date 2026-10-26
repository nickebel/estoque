-- Migração 0003: contas individuais e perfis de acesso.
-- Não altera nem apaga produtos, movimentações ou eventos de auditoria existentes.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(username) BETWEEN 3 AND 40),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','operator','viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS users_active_role_idx
ON users(active, role);

CREATE INDEX IF NOT EXISTS users_username_idx
ON users(username COLLATE NOCASE);
