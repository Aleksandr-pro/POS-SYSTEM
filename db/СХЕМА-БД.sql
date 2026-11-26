-- ============================================================================
-- POS Контроль — схема Cloudflare D1
-- Применение в веб-консоли Cloudflare: D1 → база → Console → вставить этот SQL
-- либо: wrangler d1 execute poskontrol --file=cloudflare/schema.sql --remote
-- ============================================================================

-- Универсальное хранилище записей: коллекция + JSON документа.
-- Такая схема позволяет добавлять поля без миграций и синхронизировать данные
-- одним запросом (последняя запись побеждает по updated_at).
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_records_sync ON records (collection, updated_at);
CREATE INDEX IF NOT EXISTS idx_records_deleted ON records (deleted_at);

-- Служебные значения (например, счётчик пользователей, версия схемы)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Журнал действий (для разбора спорных операций по кассе)
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,
  collection TEXT,
  entity_id  TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log (created_at DESC);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
