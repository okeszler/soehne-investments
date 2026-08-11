// Gemeinsame Hilfsfunktionen für alle Pages Functions
import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Erstellt ein signiertes Session-Token: payload.expiry.signature (Base64url für payload)
export async function createSession(env, payload, ttlSeconds = 60 * 60 * 24 * 30) {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 });
  const encoded = btoa(unescape(encodeURIComponent(body)));
  const sig = await hmac(env.SESSION_SECRET, encoded);
  return `${encoded}.${sig}`;
}

export async function verifySession(env, token) {
  if (!token) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = await hmac(env.SESSION_SECRET, encoded);
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export function setCookieHeader(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function json(data, init = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.headers) {
    const extra = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    for (const [key, value] of extra.entries()) {
      headers.append(key, value);
    }
  }
  return new Response(JSON.stringify(data), { headers, status: init.status || 200 });
}

export async function requireSonSession(request, env) {
  const token = getCookie(request, 'son_session');
  const session = await verifySession(env, token);
  if (!session || session.role !== 'son') return null;
  return session;
}

export async function requireAdminSession(request, env) {
  const token = getCookie(request, 'admin_session');
  const session = await verifySession(env, token);
  if (!session || session.role !== 'admin') return null;
  return session;
}

// Berechnet Kontostand & Verlauf (kumulativ pro Tag) aus den Transaktionen
export function computeBalanceHistory(transactions) {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const history = [];
  for (const tx of sorted) {
    const signed = tx.type === 'withdrawal' ? -tx.amount : tx.amount;
    running += signed;
    history.push({ date: tx.date, balance: Math.round(running * 100) / 100, type: tx.type, amount: tx.amount, note: tx.note });
  }
  return { balance: Math.round(running * 100) / 100, history };
}

// FLEX-Zinsen werden erst am Monatsletzten als Transaction gebucht (siehe Cron-Job).
// Für den Kontostand rechnen wir die seither anteilig aufgelaufenen, noch nicht
// gebuchten Zinsen trotzdem mit ein — unabhängig davon, dass sie erst am
// Monatsende tatsächlich verfügbar werden.
export function computeFlexAccruedInterest(transactions, cashBalance, annualRate) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const interestDates = (transactions || []).filter(t => t.type === 'interest').map(t => t.date);
  const lastCreditDateStr = interestDates.length
    ? interestDates.reduce((latest, d) => (d > latest ? d : latest))
    : ((transactions && transactions[0]) ? transactions[0].date : today.toISOString().slice(0, 10));
  const daysSinceCredit = Math.max(
    0, Math.floor((today - new Date(lastCreditDateStr + 'T00:00:00Z')) / 86400000)
  );
  return Math.round((cashBalance * annualRate * daysSinceCredit / 365) * 100) / 100;
}

export const MIN_INVESTMENT_AMOUNT = 100;

// Legt eine Investition an: prüft Produkt + FLEX-Guthaben, bucht eine Auszahlung auf
// das Cashflow-Konto und legt die gesperrte Investition an. Von Admin- und
// Sohn-Endpunkt gemeinsam genutzt, damit beide exakt dieselben Regeln durchsetzen.
export async function createInvestment(env, sonId, productId, amount) {
  if (!sonId || !productId || !(amount > 0)) {
    return { error: 'Ungültige Eingabe', status: 400 };
  }
  if (amount < MIN_INVESTMENT_AMOUNT) {
    return { error: `Mindestbetrag für eine Investition sind ${MIN_INVESTMENT_AMOUNT} €`, status: 400 };
  }

  const product = await env.DB.prepare('SELECT id, name, lock_days, active FROM products WHERE id = ?')
    .bind(productId).first();
  if (!product || !product.active) return { error: 'Produkt nicht gefunden', status: 404 };

  const { results: txs } = await env.DB.prepare(
    'SELECT type, amount FROM transactions WHERE son_id = ?'
  ).bind(sonId).all();
  const balance = (txs || []).reduce((sum, tx) => sum + (tx.type === 'withdrawal' ? -tx.amount : tx.amount), 0);
  if (amount > balance) {
    return { error: `Nicht genug FLEX-Guthaben (verfügbar: ${balance.toFixed(2)} €)`, status: 400 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const maturity = new Date();
  maturity.setUTCDate(maturity.getUTCDate() + product.lock_days);
  const maturityDate = maturity.toISOString().slice(0, 10);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(sonId, today, 'withdrawal', amount, `Investition angelegt: ${product.name}`),
    env.DB.prepare(
      `INSERT INTO investments (son_id, product_id, principal, balance, start_date, maturity_date, last_credit_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(sonId, productId, amount, amount, today, maturityDate, today)
  ]);

  return { ok: true };
}

const PERIOD_DAYS = { monthly: 30, quarterly: 91, yearly: 365, maturity: Infinity };

// Momentaufnahme einer Investition: aktueller Wert (Kapital + bis heute anteilig
// aufgelaufene Zinsen), voraussichtlicher Endwert bei Fälligkeit (simuliert dieselbe
// Perioden-Logik wie der Cron-Job, ohne etwas zu buchen) und verbleibende Tage.
export function investmentSnapshot(inv) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const lastCredit = new Date(inv.last_credit_date + 'T00:00:00Z');
  const maturity = new Date(inv.maturity_date + 'T00:00:00Z');

  const elapsedDays = Math.max(0, Math.floor((today - lastCredit) / 86400000));
  const currentValue = Math.round((inv.balance + inv.balance * inv.apy * elapsedDays / 365) * 100) / 100;

  const daysRemaining = Math.max(0, Math.ceil((maturity - today) / 86400000));

  const periodDays = PERIOD_DAYS[inv.interest_frequency] || 30;
  let value = inv.balance;
  let cursor = lastCredit;
  if (periodDays === Infinity) {
    const days = Math.max(0, Math.round((maturity - cursor) / 86400000));
    value += value * inv.apy * days / 365;
  } else {
    while (true) {
      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + periodDays);
      if (next >= maturity) {
        const days = Math.max(0, Math.round((maturity - cursor) / 86400000));
        value += value * inv.apy * days / 365;
        break;
      }
      value += value * inv.apy * periodDays / 365;
      cursor = next;
    }
  }
  const maturityValue = Math.round(value * 100) / 100;

  return { currentValue, maturityValue, daysRemaining };
}

// Schickt eine Push-Benachrichtigung an alle Geräte eines oder mehrerer Söhne.
// sonIds: Array von Sohn-IDs, oder null für alle Söhne. Räumt abgelaufene Abos
// (404/410 vom Push-Dienst) automatisch aus der DB auf.
export async function sendPushToSons(env, sonIds, payload) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  const { results: subs } = sonIds
    ? await env.DB.prepare(
        `SELECT id, son_id, endpoint, p256dh, auth FROM push_subscriptions WHERE son_id IN (${sonIds.map(() => '?').join(',')})`
      ).bind(...sonIds).all()
    : await env.DB.prepare('SELECT id, son_id, endpoint, p256dh, auth FROM push_subscriptions').all();

  for (const sub of subs || []) {
    const subscription = {
      endpoint: sub.endpoint,
      expirationTime: null,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
      const pushPayload = await buildPushPayload({ data: JSON.stringify(payload) }, subscription, vapid);
      const res = await fetch(subscription.endpoint, pushPayload);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
      }
    } catch {
      // einzelnes fehlgeschlagenes Abo soll die anderen nicht blockieren
    }
  }
}

