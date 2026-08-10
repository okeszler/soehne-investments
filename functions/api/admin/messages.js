import { requireAdminSession, sendPushToSons, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.son_id, s.name as son_name, m.body, m.created_at
     FROM messages m LEFT JOIN sons s ON s.id = m.son_id
     ORDER BY m.created_at DESC`
  ).all();

  return json({ messages: results || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, body } = await request.json();
  if (!body || typeof body !== 'string' || !body.trim()) {
    return json({ error: 'Nachricht darf nicht leer sein' }, { status: 400 });
  }

  await env.DB.prepare(
    'INSERT INTO messages (son_id, body) VALUES (?, ?)'
  ).bind(sonId || null, body.trim()).run();

  await sendPushToSons(env, sonId ? [sonId] : null, {
    title: 'Dein Kapital',
    body: body.trim()
  });

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id erforderlich' }, { status: 400 });

  await env.DB.batch([
    env.DB.prepare('DELETE FROM message_dismissals WHERE message_id = ?').bind(id),
    env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id)
  ]);

  return json({ ok: true });
}
