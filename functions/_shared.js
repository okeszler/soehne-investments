// Gemeinsame Hilfsfunktionen für alle Pages Functions

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
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    status: init.status || 200
  });
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

// Zinseszins-Hochrechnung: Startkapital, Jahreszins, Anzahl Jahre, monatliche Sparrate (optional, hier 0)
export function projectCompoundGrowth(startCapital, annualRate, years, monthlyContribution = 0) {
  const monthlyRate = annualRate / 12;
  const points = [{ month: 0, value: Math.round(startCapital * 100) / 100 }];
  let value = startCapital;
  const totalMonths = Math.round(years * 12);
  for (let m = 1; m <= totalMonths; m++) {
    value = value * (1 + monthlyRate) + monthlyContribution;
    if (m % 1 === 0) {
      points.push({ month: m, value: Math.round(value * 100) / 100 });
    }
  }
  return points;
}
