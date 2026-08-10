# Söhne-Investment-App

Kapital-Übersicht für Moritz und Florian. Jeder hat seine eigene PIN und sieht nur
sein eigenes Kapital. Du selbst trägst über einen separaten Admin-Bereich
(`/admin.html`) Buchungen, automatische Zahlungen, Anlageprodukte und
Nachrichten ein.

## Aufbau

- **Sohn-Ansicht** (`/index.html`): PIN-Login, Gesamtkontostand (FLEX +
  Investitionen), Tageszins, Verlaufsgrafik, Liste laufender Investitionen
  (Restzeit, aktueller Wert, Zinsen bei Endfälligkeit), Möglichkeit selbst in ein
  Anlageprodukt zu investieren, freier Zinseszinsrechner, FLEX-Bewegungen,
  eigene PIN ändern, In-App-Nachrichten vom Admin, optionale Push-Benachrichtigungen.
- **Admin-Ansicht** (`/admin.html`): eigene PIN, FLEX-Buchungen anlegen/löschen,
  Jahreszins pro Sohn einstellen, automatische monatliche FLEX-Buchungen (z.B.
  Taschengeld), Anlageprodukte anlegen/bearbeiten/löschen, Investitionen für
  einen Sohn anlegen, Nachrichten an einen Sohn oder alle senden.
- **Backend**: Cloudflare Pages Functions + D1.
- **Cron-Worker** (`cron-worker/`, separat deployt): täglich/monatlich
  automatisierte Buchungen — siehe unten.

## Einrichtung

### 1. D1-Datenbank anlegen

```bash
wrangler d1 create soehne-investment
```

Die zurückgegebene `database_id` in `wrangler.toml` **und** in
`cron-worker/wrangler.toml` eintragen.

### 2. Schema anwenden

```bash
wrangler d1 execute soehne-investment --remote --file=./schema.sql
```

Danach alle Migrationen der Reihe nach ausführen (jede legt eine weitere
Tabelle an bzw. erweitert das Schema):

```bash
for f in migrations/*.sql; do
  wrangler d1 execute soehne-investment --remote --file="$f"
done
```

### 3. PINs für Moritz und Florian erzeugen

```bash
node hash-pin.js 1234   # Beispiel-PIN für Moritz
node hash-pin.js 5678   # Beispiel-PIN für Florian
```

Wähle eigene 4-6-stellige PINs (unterschiedlich für beide Söhne — identische
PINs würden den Login mehrdeutig machen). Dann in D1 einfügen:

```bash
wrangler d1 execute soehne-investment --remote --command="INSERT INTO sons (name, pin_hash, annual_rate) VALUES ('Moritz', '<hash_moritz>', 0.03), ('Florian', '<hash_florian>', 0.03)"
```

`annual_rate` ist der Jahreszins des FLEX-Kontos (0.03 = 3%) — kannst du später
jederzeit im Admin-Bereich pro Sohn ändern.

### 4. Umgebungsvariablen setzen

```bash
wrangler pages secret put SESSION_SECRET --project-name=soehne-investment
# ein langer zufälliger String, z.B. via: openssl rand -hex 32

wrangler pages secret put ADMIN_PIN --project-name=soehne-investment
# deine eigene Admin-PIN, z.B. 6-8 Stellen
```

Für Push-Benachrichtigungen zusätzlich VAPID-Schlüssel generieren (P-256
Schlüsselpaar, Public Key als rohes 65-Byte-Point base64url, Private Key als
der JWK-`d`-Wert base64url) und als Secrets hinterlegen:

```bash
wrangler pages secret put VAPID_PUBLIC_KEY --project-name=soehne-investment
wrangler pages secret put VAPID_PRIVATE_KEY --project-name=soehne-investment
wrangler pages secret put VAPID_SUBJECT --project-name=soehne-investment
# z.B. mailto:deine@email.de
```

### 5. Deployen

```bash
wrangler pages deploy public --project-name=soehne-investment
```

### 6. Cron-Worker deployen (automatische Buchungen)

Läuft als separater Worker mit eigenem `wrangler.toml`, da Cloudflare Pages
Functions selbst keine Cron-Trigger unterstützen:

```bash
cd cron-worker
wrangler deploy
```

Drei Zeitpläne:

- **Monatliche FLEX-Zinsgutschrift**: an den möglichen Monatsletzten (28.-31.),
  bucht nur am tatsächlichen Monatsletzten.
- **Automatische FLEX-Buchungen** (z.B. Taschengeld): am 1. jeden Monats.
- **Investitionen**: täglich — bucht periodische Zinsen je nach
  Zinszubuchungs-Intervall des Produkts (monatlich/vierteljährlich/jährlich)
  auf die gesperrte Investition, und überweist bei Ablauf der Bindungsfrist
  Kapital + Zinsen als eine Buchung zurück aufs FLEX-Konto. Bei "endfällig"
  gibt es keine Zwischen-Gutschrift, die gesamte Verzinsung erfolgt in einer
  Summe bei Fälligkeit.

## Danach

- Sohn-Ansicht: `https://<deine-domain>/`
- Admin-Ansicht: `https://<deine-domain>/admin.html`

## Datenmodell (Kurzüberblick)

- `sons`: Name, PIN-Hash, FLEX-Jahreszins.
- `transactions`: FLEX-Bewegungen (Einzahlung/Auszahlung/Zinsgutschrift) — die
  Summe ergibt den FLEX-Kontostand eines Sohns.
- `products`: globaler Katalog der Anlageprodukte (Name, Bindungsfrist in
  Tagen, APY, Zinszubuchungs-Intervall, Beschreibungstext, aktiv/inaktiv).
- `investments`: einzelne Investitionen eines Sohns in ein Produkt (Kapital,
  laufender Wert, Start-/Fälligkeitsdatum, Status). Anlegen bucht eine
  `withdrawal`-Transaction vom FLEX-Konto; Fälligkeit bucht eine `deposit`-
  Transaction (Kapital + Zinsen) zurück.
- `recurring_bookings`: automatische monatliche FLEX-Buchungen pro Sohn.
- `messages` / `message_dismissals`: In-App-Nachrichten vom Admin, pro Sohn
  einzeln als gelesen markierbar (wichtig bei Broadcast-Nachrichten an beide).
- `push_subscriptions`: Web-Push-Abonnements pro Sohn (mehrere Geräte möglich).

## Ideen für später (nicht umgesetzt)

- E-Mail-Benachrichtigung bei neuer Buchung
- Export der Bewegungen als PDF/CSV
- Vorzeitige Auflösung einer Investition durch den Admin
