-- Fügt "maturity" (endfällig: Zinsen erst am Ende der Bindungsfrist zusammen mit dem
-- Kapital) als weitere Option für interest_frequency hinzu. SQLite kann CHECK-
-- Constraints nicht per ALTER TABLE ändern, daher wird die Tabelle neu aufgebaut.
CREATE TABLE products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lock_days INTEGER NOT NULL DEFAULT 0,
  apy REAL NOT NULL,
  interest_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (interest_frequency IN ('monthly','quarterly','yearly','maturity')),
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO products_new (id, name, lock_days, apy, interest_frequency, description, active, created_at)
SELECT id, name, lock_days, apy, interest_frequency, description, active, created_at FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
