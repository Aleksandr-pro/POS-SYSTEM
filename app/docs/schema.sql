-- ============================================================================
-- POS Контроль — схема базы Cloudflare D1 (SQLite)
-- Применение: wrangler d1 execute poskontrol-db --file=docs/schema.sql --remote
-- ============================================================================

PRAGMA foreign_keys = ON;

-- Пользователи ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash    TEXT NOT NULL,              -- pbkdf2$iterations$salt$hash
  role         TEXT NOT NULL CHECK (role IN ('admin', 'dev', 'seller')),
  point_id     TEXT REFERENCES points(id) ON DELETE SET NULL,
  work_start   TEXT,
  work_end     TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_point ON users(point_id);

-- Точки продаж ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS points (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        REAL,
  lng        REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- Категории ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- Товары ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  price       REAL NOT NULL DEFAULT 0,
  photo_key   TEXT,                         -- ключ объекта в R2 (или data:URL для малых фото)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

-- Товар ↔ точка (если строк нет — товар доступен везде) ----------------------
CREATE TABLE IF NOT EXISTS product_points (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  point_id   TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, point_id)
);

-- Остатки --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
  id         TEXT PRIMARY KEY,
  point_id   TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (point_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_history (
  id         TEXT PRIMARY KEY,
  stock_id   TEXT NOT NULL REFERENCES stock(id) ON DELETE CASCADE,
  point_id   TEXT NOT NULL,
  product_id TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  qty_after  INTEGER NOT NULL,
  note       TEXT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_hist ON stock_history(point_id, product_id, created_at DESC);

-- Продажи --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id          TEXT PRIMARY KEY,            -- UUID клиента (идемпотентность)
  code        TEXT NOT NULL,               -- короткий номер для чека
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL,               -- денормализация: сохраняется при удалении юзера
  point_id    TEXT REFERENCES points(id) ON DELETE SET NULL,
  point_name  TEXT,
  items_json  TEXT NOT NULL,               -- [{productId,name,price,qty}]
  total       REAL NOT NULL,
  payment     TEXT NOT NULL CHECK (payment IN ('cash', 'qr', 'mixed')),
  cash_amount REAL NOT NULL DEFAULT 0,
  qr_amount   REAL NOT NULL DEFAULT 0,
  receipt_key TEXT,                        -- объект в R2, не сам файл
  receipt_expires_at INTEGER,              -- created_at + 7 дней
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  synced_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_point ON sales(point_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id, created_at DESC);

-- Расходы --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  point_id   TEXT REFERENCES points(id) ON DELETE SET NULL,
  point_name TEXT,
  amount     REAL NOT NULL,
  reason     TEXT,
  pruned     INTEGER NOT NULL DEFAULT 0,   -- детали удалены через 7 дней
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(created_at DESC);

-- Рабочее время --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key    TEXT NOT NULL,               -- YYYY-MM-DD в часовом поясе точки
  arrive_at   INTEGER,
  arrive_lat  REAL,
  arrive_lng  REAL,
  arrive_acc  INTEGER,
  leave_at    INTEGER,
  leave_lat   REAL,
  leave_lng   REAL,
  leave_acc   INTEGER,
  updated_at  INTEGER NOT NULL,
  UNIQUE (user_id, date_key)
);
CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(date_key);

-- Аудит действий -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,                -- sale.create, sale.delete, stock.set, user.delete...
  entity     TEXT,
  entity_id  TEXT,
  payload    TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at DESC);

-- Настройки (контакты разработчика и т.п.) -----------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);

-- Стартовые категории --------------------------------------------------------
INSERT OR IGNORE INTO categories (id, name, sort_order, updated_at) VALUES
  ('cat-drinks', 'Напитки',     1, strftime('%s','now') * 1000),
  ('cat-bakery', 'Выпечка',     2, strftime('%s','now') * 1000),
  ('cat-snacks', 'Снеки',       3, strftime('%s','now') * 1000),
  ('cat-food',   'Готовая еда', 4, strftime('%s','now') * 1000),
  ('cat-other',  'Прочее',      5, strftime('%s','now') * 1000);

-- Полезные представления -----------------------------------------------------
CREATE VIEW IF NOT EXISTS v_daily_sales AS
SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
       point_id,
       SUM(total)  AS revenue,
       COUNT(*)    AS sales_count,
       SUM(cash_amount) AS cash,
       SUM(qr_amount)   AS qr
FROM sales
WHERE deleted_at IS NULL
GROUP BY day, point_id;

CREATE VIEW IF NOT EXISTS v_profit AS
SELECT d.day,
       d.point_id,
       d.revenue,
       IFNULL((SELECT SUM(e.amount)
               FROM expenses e
               WHERE date(e.created_at / 1000, 'unixepoch', 'localtime') = d.day
                 AND (e.point_id = d.point_id OR e.point_id IS NULL)
                 AND e.deleted_at IS NULL), 0) AS expenses,
       d.revenue - IFNULL((SELECT SUM(e.amount)
               FROM expenses e
               WHERE date(e.created_at / 1000, 'unixepoch', 'localtime') = d.day
                 AND (e.point_id = d.point_id OR e.point_id IS NULL)
                 AND e.deleted_at IS NULL), 0) AS profit
FROM v_daily_sales d;
