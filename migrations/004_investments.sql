-- Erklärungstext je Produkt (per Klick einsehbar)
ALTER TABLE products ADD COLUMN description TEXT;

-- Einzelne Investitionen eines Sohnes in ein Produkt (gesperrtes Kapital + laufend
-- gutgeschriebene Zinsen). Bei Ablauf der Bindungsfrist werden Kapital + Zinsen als
-- eine Buchung auf das Cashflow-Konto (transactions) zurücküberwiesen.
CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  principal REAL NOT NULL,
  balance REAL NOT NULL,
  start_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL,
  last_credit_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid_out')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_investments_son ON investments(son_id, status);
