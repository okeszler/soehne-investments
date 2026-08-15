-- Manche Personen (z.B. Andreea) unterliegen der Kapitalertragssteuer, andere
-- nicht (Papi übernimmt sie für Moritz/Florian). Statt das an den Namen zu
-- knüpfen, bekommt jeder Sohn einen eigenen KESt-Satz.
ALTER TABLE sons ADD COLUMN kest_rate REAL NOT NULL DEFAULT 0;
UPDATE sons SET kest_rate = 0.25 WHERE name = 'Andreea';
