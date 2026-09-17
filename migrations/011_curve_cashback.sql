-- Fügt "cashback" als weiteren Buchungstyp hinzu (für die 3%-Cashback-Gutschrift bei
-- Curve-Kartenzahlungen). SQLite kann CHECK-Constraints nicht per ALTER TABLE ändern,
-- daher wird die Tabelle neu aufgebaut.
CREATE TABLE transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','interest','cashback')),
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO transactions_new (id, son_id, date, type, amount, note, created_at)
SELECT id, son_id, date, type, amount, note, created_at FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX idx_transactions_son_date ON transactions(son_id, date);
