import { requireAdminSession, computeBalanceHistory, computeFlexAccruedInterest, investmentSnapshot, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results: sons } = await env.DB.prepare(
    'SELECT id, name, annual_rate FROM sons ORDER BY name'
  ).all();

  const withBalances = [];
  for (const son of sons || []) {
    const { results: txs } = await env.DB.prepare(
      'SELECT date, type, amount, note FROM transactions WHERE son_id = ? ORDER BY date ASC, id ASC'
    ).bind(son.id).all();
    const { balance: cashBalance } = computeBalanceHistory(txs || []);
    const flexAccruedInterest = computeFlexAccruedInterest(txs, cashBalance, son.annual_rate);

    const { results: activeInvestments } = await env.DB.prepare(
      `SELECT i.balance, i.last_credit_date, i.maturity_date, p.apy, p.interest_frequency
       FROM investments i JOIN products p ON p.id = i.product_id
       WHERE i.son_id = ? AND i.status = 'active'`
    ).bind(son.id).all();
    const investmentsTotal = (activeInvestments || []).reduce(
      (sum, inv) => sum + investmentSnapshot(inv).currentValue, 0
    );

    const balance = Math.round((cashBalance + flexAccruedInterest + investmentsTotal) * 100) / 100;
    withBalances.push({ ...son, balance, cashBalance });
  }

  return json({ sons: withBalances });
}

// Jahreszins eines Sohnes aktualisieren
export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, annualRate } = await request.json();
  if (!sonId || typeof annualRate !== 'number') {
    return json({ error: 'sonId und annualRate erforderlich' }, { status: 400 });
  }

  await env.DB.prepare('UPDATE sons SET annual_rate = ? WHERE id = ?')
    .bind(annualRate, sonId).run();

  return json({ ok: true });
}
