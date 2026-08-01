# Söhne-Investment-App

Read-only Kapital-Übersicht für Moritz und Florian. Jeder hat seine eigene PIN und sieht nur sein eigenes Kapital. Du selbst trägst über einen separaten Admin-Bereich (`/admin.html`) die Ein-/Auszahlungen und Zinsen ein.

## Aufbau

- **Sohn-Ansicht** (`/index.html`): PIN-Login, Kontostand, Tageszins, Verlaufsgrafik, Zinseszins-Hochrechnung (1/5/10/20 Jahre), Liste der Bewegungen.
- **Admin-Ansicht** (`/admin.html`): eigene PIN, Buchungen anlegen/löschen, Jahreszins pro Sohn einstellen.
- **Backend**: Cloudflare Pages Functions + D1 (gleiches Setup wie deine anderen Apps).

## Einrichtung

### 1. D1-Datenbank anlegen

```bash
wrangler d1 create soehne-investment
```

Die zurückgegebene `database_id` in `wrangler.toml` eintragen.

### 2. Schema anwenden

```bash
wrangler d1 execute soehne-investment --remote --file=./schema.sql
```

### 3. PINs für Moritz und Florian erzeugen

```bash
node hash-pin.js 1234   # Beispiel-PIN für Moritz
node hash-pin.js 5678   # Beispiel-PIN für Florian
```

Wähle eigene 4-6-stellige PINs. Dann in D1 einfügen:

```bash
wrangler d1 execute soehne-investment --remote --command="INSERT INTO sons (name, pin_hash, annual_rate) VALUES ('Moritz', '<hash_moritz>', 0.03), ('Florian', '<hash_florian>', 0.03)"
```

`annual_rate` ist der angenommene Jahreszins (0.03 = 3%) für Tageszins-Anzeige und Hochrechnung — kannst du später jederzeit im Admin-Bereich pro Sohn ändern.

### 4. Umgebungsvariablen setzen

Zwei Secrets werden gebraucht:

```bash
wrangler pages secret put SESSION_SECRET
# ein langer zufälliger String, z.B. via: openssl rand -hex 32

wrangler pages secret put ADMIN_PIN
# deine eigene Admin-PIN, z.B. 6-8 Stellen
```

### 5. Deployen

```bash
wrangler pages deploy public
```

## Danach

- Sohn-Ansicht: `https://<deine-domain>/`
- Admin-Ansicht: `https://<deine-domain>/admin.html`

Buchungen (Einzahlung/Auszahlung/Zinsgutschrift) trägst du im Admin-Bereich ein — die Söhne sehen alles read-only, inklusive Verlaufsgrafik und einer fiktiven Zinseszins-Hochrechnung basierend auf dem aktuellen Kontostand und dem hinterlegten Jahreszins.

## Ideen für später (nicht umgesetzt)

- E-Mail-Benachrichtigung bei neuer Buchung (ähnlich wie bei [[finanzen-violeta]])
- Mehrere Jahreszinsen historisch (statt nur aktuellem Wert)
- Export der Bewegungen als PDF/CSV
