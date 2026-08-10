import { requireSonSession, json } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results } = await env.DB.prepare(
    'SELECT id, name, lock_days, apy, interest_frequency, description FROM products WHERE active = 1 ORDER BY id ASC'
  ).all();

  return json({ products: results || [] });
}
