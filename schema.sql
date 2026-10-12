-- MJ AUTOS POS schema (PostgreSQL / Neon). Safe to run many times.

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(10)  NOT NULL CHECK (role IN ('owner', 'cashier')),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  token_version  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150)  NOT NULL,
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  stock_qty   INTEGER       NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  min_stock   INTEGER       NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique_idx ON products (LOWER(name));

CREATE SEQUENCE IF NOT EXISTS bill_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS bills (
  id             SERIAL PRIMARY KEY,
  bill_number    BIGINT        NOT NULL UNIQUE DEFAULT nextval('bill_number_seq'),
  customer_name  VARCHAR(100),
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  grand_total    NUMERIC(12,2) NOT NULL CHECK (grand_total >= 0),
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bills_created_at_idx ON bills (created_at DESC);

CREATE TABLE IF NOT EXISTS bill_items (
  id          SERIAL PRIMARY KEY,
  bill_id     INTEGER       NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  product_id  INTEGER       REFERENCES products(id) ON DELETE SET NULL,  -- NULL = manual item
  item_name   VARCHAR(150)  NOT NULL,
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  quantity    INTEGER       NOT NULL CHECK (quantity > 0),
  line_total  NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS bill_items_bill_idx ON bill_items (bill_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty  INTEGER     NOT NULL,                -- + added, - sold/removed
  reason      VARCHAR(20) NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment')),
  note        VARCHAR(255),
  bill_id     INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements (product_id, created_at DESC);

-- Remembers which low-stock alerts were already sent by email/WhatsApp today (anti-spam).
CREATE TABLE IF NOT EXISTS stock_alert_log (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alert_date  DATE    NOT NULL,
  PRIMARY KEY (product_id, alert_date)
);
