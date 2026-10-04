import { requireAdminSession, computeBalanceHistory, computeFlexAccruedInterest, investmentSnapshot, json } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { results: sons } = await env.DB.prepare(
    'SELECT id, name, annual_rate, kest_rate, cashback_rate, sender_name FROM sons ORDER BY name'
  ).all();

  const withBalances = [];
  for (const son of sons || []) {
    const { results: txs } = await env.DB.prepare(
      'SELECT date, type, amount, note FROM transactions WHERE son_id = ? ORDER BY date ASC, id ASC'
    ).bind(son.id).all();
    const { balance: cashBalance } = computeBalanceHistory(txs || []);
    const flexAccruedInterest = computeFlexAccruedInterest(txs, cashBalance, son.annual_rate, son.kest_rate);

    const { results: activeInvestments } = await env.DB.prepare(
      `SELECT i.balance, i.last_credit_date, i.maturity_date, p.apy, p.interest_frequency
       FROM investments i JOIN products p ON p.id = i.product_id
       WHERE i.son_id = ? AND i.status = 'active'`
    ).bind(son.id).all();
    const investmentsTotal = (activeInvestments || []).reduce(
      (sum, inv) => sum + investmentSnapshot({ ...inv, kest_rate: son.kest_rate }).currentValue, 0
    );

    const { results: changes } = await env.DB.prepare(
      `SELECT annual_rate, cashback_rate, kest_rate, changed_at FROM son_condition_changes
       WHERE son_id = ? ORDER BY changed_at DESC, id DESC LIMIT 10`
    ).bind(son.id).all();

    const balance = Math.round((cashBalance + flexAccruedInterest + investmentsTotal) * 100) / 100;
    withBalances.push({ ...son, balance, cashBalance, changes: changes || [] });
  }

  return json({ sons: withBalances });
}

const ALLOWED_KEST_RATES = [0, 0.25, 0.275];

// Konditionen einer Person aktualisieren: Jahreszins, Cashback-Satz, KESt-Satz und
// Absendername. Alle Felder sind optional; nicht übergebene bleiben unverändert.
// Änderungen an Zins/Cashback/KESt gelten ab sofort und werden protokolliert —
// bereits gebuchte Zinsen und Cashback-Gutschriften bleiben unverändert.
export async function onRequestPost({ request, env }) {
  const session = await requireAdminSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { sonId, annualRate, cashbackRate, kestRate, senderName } = await request.json();
  if (!sonId) return json({ error: 'sonId erforderlich' }, { status: 400 });

  const son = await env.DB.prepare(
    'SELECT id, annual_rate, cashback_rate, kest_rate, sender_name FROM sons WHERE id = ?'
  ).bind(sonId).first();
  if (!son) return json({ error: 'Person nicht gefunden' }, { status: 404 });

  const isRate = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0.5;
  if (annualRate !== undefined && !isRate(annualRate)) return json({ error: 'Ungültiger Zinssatz' }, { status: 400 });
  if (cashbackRate !== undefined && !isRate(cashbackRate)) return json({ error: 'Ungültiger Cashback-Satz' }, { status: 400 });
  if (kestRate !== undefined && !ALLOWED_KEST_RATES.includes(kestRate)) return json({ error: 'Ungültiger KESt-Satz' }, { status: 400 });
  if (senderName !== undefined && senderName !== null && typeof senderName !== 'string') {
    return json({ error: 'Ungültiger Absendername' }, { status: 400 });
  }

  const next = {
    annual_rate: annualRate ?? son.annual_rate,
    cashback_rate: cashbackRate ?? son.cashback_rate,
    kest_rate: kestRate ?? son.kest_rate,
    sender_name: senderName === undefined ? son.sender_name : ((senderName || '').trim().slice(0, 30) || null)
  };

  const statements = [
    env.DB.prepare('UPDATE sons SET annual_rate = ?, cashback_rate = ?, kest_rate = ?, sender_name = ? WHERE id = ?')
      .bind(next.annual_rate, next.cashback_rate, next.kest_rate, next.sender_name, sonId)
  ];
  const conditionsChanged = next.annual_rate !== son.annual_rate
    || next.cashback_rate !== son.cashback_rate
    || next.kest_rate !== son.kest_rate;
  if (conditionsChanged) {
    statements.push(env.DB.prepare(
      'INSERT INTO son_condition_changes (son_id, annual_rate, cashback_rate, kest_rate) VALUES (?, ?, ?, ?)'
    ).bind(sonId, next.annual_rate, next.cashback_rate, next.kest_rate));
  }
  await env.DB.batch(statements);

  return json({ ok: true });
}
