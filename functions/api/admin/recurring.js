import { requireAdminSession, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results } = await env.DB.prepare(
    'SELECT id, son_id, type, amount, note FROM recurring_bookings ORDER BY id ASC'
  ).all();

  return json({ recurring: results || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, type, amount, note } = await request.json();
  if (!sonId || !['deposit', 'withdrawal', 'interest'].includes(type) || !(amount > 0)) {
    return json({ error: 'Ungültige Eingabe' }, { status: 400 });
  }

  await env.DB.prepare(
    'INSERT INTO recurring_bookings (son_id, type, amount, note) VALUES (?, ?, ?, ?)'
  ).bind(sonId, type, amount, note || null).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id erforderlich' }, { status: 400 });

  await env.DB.prepare('DELETE FROM recurring_bookings WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
