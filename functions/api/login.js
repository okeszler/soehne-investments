import { sha256Hex, createSession, setCookieHeader, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const { pin } = await request.json();
  if (!pin || typeof pin !== 'string') {
    return json({ error: 'PIN fehlt' }, { status: 400 });
  }

  const pinHash = await sha256Hex(pin);
  const { results } = await env.DB.prepare(
    'SELECT id, name FROM sons WHERE pin_hash = ?'
  ).bind(pinHash).all();

  if (!results || results.length === 0) {
    return json({ error: 'PIN ungültig' }, { status: 401 });
  }
  if (results.length > 1) {
    // Zwei Söhne mit identischem PIN-Hash (sollte durch change-pin.js verhindert
    // werden) — lieber ablehnen als willkürlich einen davon einloggen.
    return json({ error: 'PIN mehrdeutig, bitte PIN ändern lassen' }, { status: 409 });
  }

  const son = results[0];
  const token = await createSession(env, { role: 'son', sonId: son.id, name: son.name });

  return json({ ok: true, name: son.name }, {
    headers: { 'Set-Cookie': setCookieHeader('son_session', token, 60 * 60 * 24 * 30) }
  });
}
