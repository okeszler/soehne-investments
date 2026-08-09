import { requireAdminSession, json } from '../../_shared.js';

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
  if (!sonId || !productId || !(amount > 0)) {
    return json({ error: 'Ungültige Eingabe' }, { status: 400 });
  }

  const product = await env.DB.prepare('SELECT id, lock_days, active FROM products WHERE id = ?')
    .bind(productId).first();
  if (!product || !product.active) return json({ error: 'Produkt nicht gefunden' }, { status: 404 });

  const { results: txs } = await env.DB.prepare(
    'SELECT type, amount FROM transactions WHERE son_id = ?'
  ).bind(sonId).all();
  const balance = (txs || []).reduce((sum, tx) => sum + (tx.type === 'withdrawal' ? -tx.amount : tx.amount), 0);
  if (amount > balance) {
    return json({ error: `Nicht genug FLEX-Guthaben (verfügbar: ${balance.toFixed(2)} €)` }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const maturity = new Date();
  maturity.setUTCDate(maturity.getUTCDate() + product.lock_days);
  const maturityDate = maturity.toISOString().slice(0, 10);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(sonId, today, 'withdrawal', amount, 'Investition angelegt'),
    env.DB.prepare(
      `INSERT INTO investments (son_id, product_id, principal, balance, start_date, maturity_date, last_credit_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(sonId, productId, amount, amount, today, maturityDate, today)
  ]);

  return json({ ok: true });
}
