-- Migração 0002: trilha de auditoria para o estoque compartilhado.
-- Não remove nem altera produtos ou movimentações existentes.
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

CREATE INDEX IF NOT EXISTS audit_events_date_idx
ON audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_product_idx
ON audit_events(product_id);
