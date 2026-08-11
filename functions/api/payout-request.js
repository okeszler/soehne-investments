import { requireSonSession, computeBalanceHistory, sendEmail, json } from '../_shared.js';

const ADMIN_EMAIL = 'okeszler@gmail.com';

export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { amount, note } = await request.json();
  if (!(amount > 0)) return json({ error: 'Ungültiger Betrag' }, { status: 400 });

  const son = await env.DB.prepare('SELECT id, name FROM sons WHERE id = ?')
    .bind(session.sonId).first();
  if (!son) return json({ error: 'Nicht gefunden' }, { status: 404 });

  const { results: txs } = await env.DB.prepare(
    'SELECT date, type, amount, note FROM transactions WHERE son_id = ?'
  ).bind(son.id).all();
  const { balance: cashBalance } = computeBalanceHistory(txs || []);
  if (amount > cashBalance) {
    return json({ error: `Nicht genug verfügbares Guthaben (verfügbar: ${cashBalance.toFixed(2)} €)` }, { status: 400 });
  }

  const trimmedNote = (note || '').trim().slice(0, 500);
  await env.DB.prepare(
    'INSERT INTO payout_requests (son_id, amount, note) VALUES (?, ?, ?)'
  ).bind(son.id, amount, trimmedNote || null).run();

  const amountText = amount.toFixed(2).replace('.', ',');
  await sendEmail(env, {
    to: ADMIN_EMAIL,
    subject: `Auszahlungsantrag von ${son.name}: ${amountText} €`,
    text: `${son.name} hat eine Auszahlung von ${amountText} € beantragt.` +
      (trimmedNote ? `\n\nNotiz: ${trimmedNote}` : '') +
      `\n\nBitte im Admin-Bereich prüfen und manuell buchen.`
  });

  return json({ ok: true });
}
