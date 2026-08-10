import { requireAdminSession, createInvestment, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const sonId = url.searchParams.get('sonId');
  if (!sonId) return json({ error: 'sonId erforderlich' }, { status: 400 });

  const { results } = await env.DB.prepare(
    `SELECT i.id, i.product_id, p.name as product_name, i.principal, i.balance,
            i.start_date, i.maturity_date, i.status
     FROM investments i JOIN products p ON p.id = i.product_id
     WHERE i.son_id = ? ORDER BY i.status ASC, i.maturity_date ASC`
  ).bind(sonId).all();

  return json({ investments: results || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, productId, amount } = await request.json();
  const result = await createInvestment(env, sonId, productId, amount);
  if (result.error) return json({ error: result.error }, { status: result.status });
  return json({ ok: true });
}
