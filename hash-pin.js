// Hilfsskript zum Erzeugen eines PIN-Hashes für die sons-Tabelle.
// Aufruf: node hash-pin.js 1234
const crypto = require('crypto');
const pin = process.argv[2];
if (!pin) {
  console.error('Bitte PIN als Argument übergeben, z.B.: node hash-pin.js 1234');
  process.exit(1);
}
console.log(crypto.createHash('sha256').update(pin).digest('hex'));
