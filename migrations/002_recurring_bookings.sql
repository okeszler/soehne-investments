-- Automatische monatliche Buchungen (z.B. Taschengeld), werden am 1. jeden Monats gebucht.
CREATE TABLE IF NOT EXISTS recurring_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','interest')),
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
