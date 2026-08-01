-- Schema für die Söhne-Investment-App
-- Ausführen mit: wrangler d1 execute soehne-investment --file=./schema.sql

DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS sons;

CREATE TABLE sons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,          -- SHA-256 Hash der 4-6 stelligen PIN
  annual_rate REAL NOT NULL DEFAULT 0.03,  -- angenommener Jahreszins für Hochrechnung/Tageszins, z.B. 0.03 = 3%
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  date TEXT NOT NULL,               -- YYYY-MM-DD
  type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','interest')),
  amount REAL NOT NULL,             -- immer positiv, Vorzeichen ergibt sich aus type
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_son_date ON transactions(son_id, date);

-- Beispiel zum Anlegen der Söhne (PINs bitte selbst hashen, siehe README):
-- INSERT INTO sons (name, pin_hash, annual_rate) VALUES ('Moritz', '<hash>', 0.03);
-- INSERT INTO sons (name, pin_hash, annual_rate) VALUES ('Florian', '<hash>', 0.03);
