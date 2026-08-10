import { requireSonSession, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { subscription } = await request.json();
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return json({ error: 'Ungültiges Abonnement' }, { status: 400 });
  }

  await env.DB.prepare(
    `INSERT INTO push_subscriptions (son_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET son_id = excluded.son_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(session.sonId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { endpoint } = await request.json();
  if (!endpoint) return json({ error: 'endpoint erforderlich' }, { status: 400 });

  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND son_id = ?')
    .bind(endpoint, session.sonId).run();

  return json({ ok: true });
}
