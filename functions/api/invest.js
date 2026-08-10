import { requireSonSession, createInvestment, json } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { productId, amount } = await request.json();
  const result = await createInvestment(env, session.sonId, productId, amount);
  if (result.error) return json({ error: result.error }, { status: result.status });
  return json({ ok: true });
}
