import { requireSonSession, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { messageId } = await request.json();
  if (!messageId) return json({ error: 'messageId erforderlich' }, { status: 400 });

  await env.DB.prepare(
    'INSERT OR IGNORE INTO message_dismissals (message_id, son_id) VALUES (?, ?)'
  ).bind(messageId, session.sonId).run();

  return json({ ok: true });
}
