-- Auszahlungsanträge: ein Sohn beantragt eine Auszahlung vom FLEX-Konto,
-- Admin bekommt eine E-Mail und wickelt die tatsächliche Buchung manuell ab.
CREATE TABLE IF NOT EXISTS payout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  amount REAL NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
