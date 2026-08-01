import { sha256Hex, requireSonSession, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { currentPin, newPin } = await request.json();
  if (!currentPin || !newPin || typeof currentPin !== 'string' || typeof newPin !== 'string') {
    return json({ error: 'PIN fehlt' }, { status: 400 });
  }
  if (!/^\d{4,6}$/.test(newPin)) {
    return json({ error: 'Neue PIN muss 4-6 Ziffern haben' }, { status: 400 });
  }

  const son = await env.DB.prepare('SELECT pin_hash FROM sons WHERE id = ?')
    .bind(session.sonId).first();
  if (!son) return json({ error: 'Nicht gefunden' }, { status: 404 });

  const currentHash = await sha256Hex(currentPin);
  if (currentHash !== son.pin_hash) {
    return json({ error: 'Aktuelle PIN ist falsch' }, { status: 401 });
  }

  const newHash = await sha256Hex(newPin);
  await env.DB.prepare('UPDATE sons SET pin_hash = ? WHERE id = ?')
    .bind(newHash, session.sonId).run();

  return json({ ok: true });
}
