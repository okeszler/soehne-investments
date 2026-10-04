-- Konditionen und Anzeige pro Person, im Admin-Bereich jederzeit änderbar:
--  * cashback_rate: Cashback auf Curve-Zahlungen (0 = kein Cashback, wird dann
--    in der App auch nicht angezeigt). Bisher fest 3 % für alle.
--  * sender_name: wie der Admin in Nachrichten und Hinweisen heißt (z.B. "Papi");
--    leer = neutrale Texte.
--  * palette: vom Nutzer selbst gewähltes Farbschema (Standard Nachtblau).
ALTER TABLE sons ADD COLUMN cashback_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE sons ADD COLUMN sender_name TEXT;
ALTER TABLE sons ADD COLUMN palette TEXT NOT NULL DEFAULT 'blau';

UPDATE sons SET cashback_rate = 0.03 WHERE name = 'Moritz';
UPDATE sons SET sender_name = 'Papi' WHERE name IN ('Moritz', 'Florian');

-- Protokoll der Konditionsänderungen (Zinssatz, Cashback, KESt) für den
-- Änderungsverlauf im Admin-Bereich. Ein Eintrag beschreibt die ab changed_at
-- geltenden Werte.
CREATE TABLE son_condition_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER NOT NULL REFERENCES sons(id),
  annual_rate REAL NOT NULL,
  cashback_rate REAL NOT NULL,
  kest_rate REAL NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_son_condition_changes_son ON son_condition_changes(son_id, changed_at);

-- Ausgangsstand festhalten, damit der Verlauf nicht leer beginnt.
INSERT INTO son_condition_changes (son_id, annual_rate, cashback_rate, kest_rate, changed_at)
SELECT id, annual_rate, cashback_rate, kest_rate, created_at FROM sons;
