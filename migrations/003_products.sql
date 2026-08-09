-- Katalog der Anlageprodukte (z.B. "P2P-Kredite"), die Söhnen künftig neben dem
-- flexiblen Geld (sons.annual_rate) zur Verfügung stehen sollen.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lock_days INTEGER NOT NULL DEFAULT 0,
  apy REAL NOT NULL,
  interest_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (interest_frequency IN ('monthly','quarterly','yearly')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
