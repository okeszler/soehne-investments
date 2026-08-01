import { requireAdminSession, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const sonId = url.searchParams.get('sonId');
  if (!sonId) return json({ error: 'sonId erforderlich' }, { status: 400 });

  const { results } = await env.DB.prepare(
    'SELECT id, date, type, amount, note FROM transactions WHERE son_id = ? ORDER BY date DESC, id DESC'
  ).bind(sonId).all();

  return json({ transactions: results || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, date, type, amount, note } = await request.json();
  if (!sonId || !date || !['deposit', 'withdrawal', 'interest'].includes(type) || !(amount > 0)) {
    return json({ error: 'Ungültige Eingabe' }, { status: 400 });
  }

  await env.DB.prepare(
    'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
  ).bind(sonId, date, type, amount, note || null).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id erforderlich' }, { status: 400 });

  await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
