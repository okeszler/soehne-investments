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

  const { balance: cashBalance, history } = computeBalanceHistory(txs || []);

  const { results: activeInvestments } = await env.DB.prepare(
    `SELECT i.id, i.principal, i.balance, i.start_date, i.maturity_date,
            p.name as product_name, p.apy, p.lock_days, p.interest_frequency, p.description
     FROM investments i JOIN products p ON p.id = i.product_id
     WHERE i.son_id = ? AND i.status = 'active' ORDER BY i.maturity_date ASC`
  ).bind(son.id).all();

  const investmentsTotal = Math.round(
    (activeInvestments || []).reduce((sum, inv) => sum + inv.balance, 0) * 100
  ) / 100;
  const balance = Math.round((cashBalance + investmentsTotal) * 100) / 100;

  const dailyInterest = Math.round((
    (cashBalance * son.annual_rate / 365) +
    (activeInvestments || []).reduce((sum, inv) => sum + (inv.balance * inv.apy / 365), 0)
  ) * 100) / 100;

  const { results: messages } = await env.DB.prepare(
    `SELECT id, body, created_at FROM messages
     WHERE (son_id = ? OR son_id IS NULL)
       AND id NOT IN (SELECT message_id FROM message_dismissals WHERE son_id = ?)
     ORDER BY created_at DESC`
  ).bind(son.id, son.id).all();

  const { results: recurring } = await env.DB.prepare(
    'SELECT type, amount FROM recurring_bookings WHERE son_id = ?'
  ).bind(son.id).all();
  const monthlyContribution = Math.round(
    (recurring || []).reduce((sum, r) => sum + (r.type === 'withdrawal' ? -r.amount : r.amount), 0) * 100
  ) / 100;

  const projections = {
    '1': projectCompoundGrowth(cashBalance, son.annual_rate, 1, monthlyContribution),
    '5': projectCompoundGrowth(cashBalance, son.annual_rate, 5, monthlyContribution),
    '10': projectCompoundGrowth(cashBalance, son.annual_rate, 10, monthlyContribution),
    '20': projectCompoundGrowth(cashBalance, son.annual_rate, 20, monthlyContribution)
  };

  return json({
    name: son.name,
    annualRate: son.annual_rate,
    balance,
    cashBalance,
    dailyInterest,
    monthlyContribution,
    history,
    transactions: txs,
    projections,
    messages: (messages || []).map(m => ({ id: m.id, body: m.body, createdAt: m.created_at })),
    investments: (activeInvestments || []).map(inv => ({
      id: inv.id,
      productName: inv.product_name,
      description: inv.description,
      apy: inv.apy,
      lockDays: inv.lock_days,
      interestFrequency: inv.interest_frequency,
      principal: inv.principal,
      balance: inv.balance,
      startDate: inv.start_date,
      maturityDate: inv.maturity_date
    }))
  });
}
