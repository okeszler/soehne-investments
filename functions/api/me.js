import { requireSonSession, computeBalanceHistory, computeFlexAccruedInterest, investmentSnapshot, investmentValueAtDate, json } from '../_shared.js';

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

  const flexAccruedInterest = computeFlexAccruedInterest(txs, cashBalance, son.annual_rate);

  const { results: allInvestments } = await env.DB.prepare(
    `SELECT i.id, i.principal, i.balance, i.start_date, i.maturity_date, i.last_credit_date, i.status,
            p.name as product_name, p.apy, p.lock_days, p.interest_frequency, p.description
     FROM investments i JOIN products p ON p.id = i.product_id
     WHERE i.son_id = ? ORDER BY i.maturity_date ASC`
  ).bind(son.id).all();

  const activeInvestments = (allInvestments || []).filter(inv => inv.status === 'active');
  const investmentsWithSnapshot = activeInvestments.map(inv => ({
    ...inv,
    ...investmentSnapshot(inv)
  }));

  const investmentsTotal = Math.round(
    investmentsWithSnapshot.reduce((sum, inv) => sum + inv.currentValue, 0) * 100
  ) / 100;
  const balance = Math.round((cashBalance + flexAccruedInterest + investmentsTotal) * 100) / 100;

  // Der Verlauf basiert sonst nur auf FLEX-Transaktionen — beim Anlegen einer
  // Investition gibt's dort eine `withdrawal`, wodurch der Graph einbrechen würde,
  // obwohl das Kapital nur gebunden statt weg ist. Rechnet den gebundenen Wert
  // jeder Investition (aktiv + bereits ausbezahlt) zu jedem Verlaufspunkt dazu.
  const historyWithInvestments = history.map(h => {
    const asOfDate = new Date(h.date + 'T00:00:00Z');
    const investedValue = (allInvestments || []).reduce(
      (sum, inv) => sum + investmentValueAtDate(inv, asOfDate), 0
    );
    return { ...h, balance: Math.round((h.balance + investedValue) * 100) / 100 };
  });

  const dailyInterest = Math.round((
    (cashBalance * son.annual_rate / 365) +
    investmentsWithSnapshot.reduce((sum, inv) => sum + (inv.currentValue * inv.apy / 365), 0)
  ) * 100) / 100;

  const { results: messages } = await env.DB.prepare(
    `SELECT id, body, created_at FROM messages
     WHERE (son_id = ? OR son_id IS NULL)
       AND id NOT IN (SELECT message_id FROM message_dismissals WHERE son_id = ?)
     ORDER BY created_at DESC`
  ).bind(son.id, son.id).all();

  return json({
    name: son.name,
    annualRate: son.annual_rate,
    balance,
    cashBalance,
    flexAccruedInterest,
    dailyInterest,
    history: historyWithInvestments,
    transactions: txs,
    messages: (messages || []).map(m => ({ id: m.id, body: m.body, createdAt: m.created_at })),
    investments: investmentsWithSnapshot.map(inv => ({
      id: inv.id,
      productName: inv.product_name,
      description: inv.description,
      apy: inv.apy,
      lockDays: inv.lock_days,
      interestFrequency: inv.interest_frequency,
      principal: inv.principal,
      balance: inv.balance,
      currentValue: inv.currentValue,
      maturityValue: inv.maturityValue,
      daysRemaining: inv.daysRemaining,
      startDate: inv.start_date,
      maturityDate: inv.maturity_date
    }))
  });
}
