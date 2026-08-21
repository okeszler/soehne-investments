-- E-Mail-Adresse pro Person für den monatlichen Kontoauszug (Issue #1).
ALTER TABLE sons ADD COLUMN email TEXT;
UPDATE sons SET email = 'moritz.keszler@gmail.com' WHERE name = 'Moritz';
UPDATE sons SET email = 'flo.keszler@gmail.com' WHERE name = 'Florian';
UPDATE sons SET email = 'raluca.niedermayr@gmail.com' WHERE name = 'Andreea';
