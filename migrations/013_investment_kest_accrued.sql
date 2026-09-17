-- Verfolgt die über die Laufzeit einer Investition kumuliert abgezogene KESt,
-- damit die Rückzahlung bei Fälligkeit in Kapital / Zinsgutschrift (brutto) /
-- KESt aufgesplittet werden kann, statt als eine bereits verrechnete Summe
-- "inkl. Zinsen" gebucht zu werden.
ALTER TABLE investments ADD COLUMN kest_accrued REAL NOT NULL DEFAULT 0;
