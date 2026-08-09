-- In-App-Nachrichten vom Admin an einen Sohn (son_id gesetzt) oder alle (son_id NULL).
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  son_id INTEGER REFERENCES sons(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wer eine Nachricht bereits weggeklickt hat (pro Sohn, damit eine Broadcast-Nachricht
-- für den anderen Sohn sichtbar bleibt).
CREATE TABLE IF NOT EXISTS message_dismissals (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  son_id INTEGER NOT NULL REFERENCES sons(id),
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, son_id)
);
