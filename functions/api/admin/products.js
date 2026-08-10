import { requireAdminSession, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results } = await env.DB.prepare(
    'SELECT id, name, lock_days, apy, interest_frequency, description, active FROM products ORDER BY id ASC'
  ).all();

  return json({ products: results || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { name, lockDays, apy, interestFrequency, description } = await request.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return json({ error: 'Name erforderlich' }, { status: 400 });
  }
  if (typeof lockDays !== 'number' || lockDays < 0) {
    return json({ error: 'Bindung (Tage) ungültig' }, { status: 400 });
  }
  if (typeof apy !== 'number' || apy < 0) {
    return json({ error: 'APY ungültig' }, { status: 400 });
  }
  if (!['monthly', 'quarterly', 'yearly', 'maturity'].includes(interestFrequency)) {
    return json({ error: 'Zinszubuchung ungültig' }, { status: 400 });
  }

  await env.DB.prepare(
    'INSERT INTO products (name, lock_days, apy, interest_frequency, description) VALUES (?, ?, ?, ?, ?)'
  ).bind(name.trim(), lockDays, apy, interestFrequency, (description || '').trim() || null).run();

  return json({ ok: true });
}

export async function onRequestPatch({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { id, active, name, lockDays, apy, interestFrequency, description } = await request.json();
  if (!id) return json({ error: 'id erforderlich' }, { status: 400 });

  // Nur active mitgegeben (z.B. Deaktivieren) -> gezielt nur das aktualisieren
  if (typeof active === 'boolean' && name === undefined) {
    await env.DB.prepare('UPDATE products SET active = ? WHERE id = ?')
      .bind(active ? 1 : 0, id).run();
    return json({ ok: true });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return json({ error: 'Name erforderlich' }, { status: 400 });
  }
  if (typeof lockDays !== 'number' || lockDays < 0) {
    return json({ error: 'Bindung (Tage) ungültig' }, { status: 400 });
  }
  if (typeof apy !== 'number' || apy < 0) {
    return json({ error: 'APY ungültig' }, { status: 400 });
  }
  if (!['monthly', 'quarterly', 'yearly', 'maturity'].includes(interestFrequency)) {
    return json({ error: 'Zinszubuchung ungültig' }, { status: 400 });
  }

  await env.DB.prepare(
    'UPDATE products SET name = ?, lock_days = ?, apy = ?, interest_frequency = ?, description = ?, active = ? WHERE id = ?'
  ).bind(
    name.trim(), lockDays, apy, interestFrequency, (description || '').trim() || null,
    typeof active === 'boolean' ? (active ? 1 : 0) : 1, id
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id erforderlich' }, { status: 400 });

  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
