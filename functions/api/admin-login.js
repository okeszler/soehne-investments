import { createSession, setCookieHeader, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const { pin } = await request.json();
  if (!pin || pin !== env.ADMIN_PIN) {
    return json({ error: 'PIN ungültig' }, { status: 401 });
  }
  const token = await createSession(env, { role: 'admin' });
  return json({ ok: true }, {
    headers: { 'Set-Cookie': setCookieHeader('admin_session', token, 60 * 60 * 12) }
  });
}
