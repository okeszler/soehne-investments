import { requireSonSession, computeBalanceHistory, projectCompoundGrowth, json } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const son = await env.DB.prepare('SELECT id, name, annual_rate FROM sons WHERE id = ?')
    .bind(session.sonId).first();
  if (!son) return json({ error: 'Nicht gefunden' }, { status: 404 });

  const { results: txs } = await env.DB.prepare(
    'SELECT date, type, amount, note FROM transactions WHERE son_id = ? ORDER BY date ASC, id ASC'
  ).bind(son.id).all();

  const { balance, history } = computeBalanceHistory(txs || []);
  const dailyInterest = Math.round((balance * son.annual_rate / 365) * 100) / 100;

  const projections = {
    '1': projectCompoundGrowth(balance, son.annual_rate, 1),
    '5': projectCompoundGrowth(balance, son.annual_rate, 5),
    '10': projectCompoundGrowth(balance, son.annual_rate, 10),
    '20': projectCompoundGrowth(balance, son.annual_rate, 20)
  };

  return json({
    name: son.name,
    annualRate: son.annual_rate,
    balance,
    dailyInterest,
    history,
    transactions: txs,
    projections
  });
}
