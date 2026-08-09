// Drei Cron-Trigger (siehe wrangler.toml): Zinsgutschrift an den möglichen Monatsletzten,
// automatische Buchungen (z.B. Taschengeld) am 1. jeden Monats, Investitionen täglich.
export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 1 * *') {
      await runRecurringBookings(env);
    } else if (event.cron === '0 22 * * *') {
      await runInvestments(env);
    } else {
      await runMonthlyInterest(env);
    }
  }
};

const PERIOD_DAYS = { monthly: 30, quarterly: 91, yearly: 365 };

// Läuft täglich: bucht periodische Zinsen je Produkt-Intervall auf die gesperrte
// Investition, und überweist bei Ablauf der Bindungsfrist Kapital + Zinsen als eine
// Buchung zurück aufs Cashflow-Konto (transactions).
async function runInvestments(env) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayStr = today.toISOString().slice(0, 10);

  const { results: investments } = await env.DB.prepare(
    `SELECT i.id, i.son_id, i.balance, i.maturity_date, i.last_credit_date,
            p.name as product_name, p.apy, p.interest_frequency
     FROM investments i JOIN products p ON p.id = i.product_id
     WHERE i.status = 'active'`
  ).all();

  for (const inv of investments || []) {
    const elapsedDays = Math.floor((today - new Date(inv.last_credit_date + 'T00:00:00Z')) / 86400000);
    let balance = inv.balance;
    if (elapsedDays > 0) {
      const interest = Math.round((inv.balance * inv.apy * elapsedDays / 365) * 100) / 100;
      balance = Math.round((inv.balance + interest) * 100) / 100;
    }

    if (todayStr >= inv.maturity_date) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
        ).bind(inv.son_id, todayStr, 'deposit', balance, `Rückzahlung: ${inv.product_name} (inkl. Zinsen)`),
        env.DB.prepare(
          "UPDATE investments SET status = 'paid_out', balance = ?, last_credit_date = ? WHERE id = ?"
        ).bind(balance, todayStr, inv.id)
      ]);
      continue;
    }

    const periodDays = PERIOD_DAYS[inv.interest_frequency] || 30;
    if (elapsedDays < periodDays) continue; // noch keine volle Zinsperiode vergangen

    await env.DB.prepare(
      'UPDATE investments SET balance = ?, last_credit_date = ? WHERE id = ?'
    ).bind(balance, todayStr, inv.id).run();
  }
}

async function runMonthlyInterest(env) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);
  if (tomorrow.getUTCDate() !== 1) return; // heute ist nicht der Monatsletzte

  const dateStr = today.toISOString().slice(0, 10);

  const { results: sons } = await env.DB.prepare('SELECT id, annual_rate FROM sons').all();

  for (const son of sons) {
    const existing = await env.DB.prepare(
      "SELECT id FROM transactions WHERE son_id = ? AND date = ? AND type = 'interest'"
    ).bind(son.id, dateStr).first();
    if (existing) continue; // schon gebucht (z.B. bei Retry)

    const { results: txs } = await env.DB.prepare(
      'SELECT type, amount FROM transactions WHERE son_id = ?'
    ).bind(son.id).all();

    let balance = 0;
    for (const tx of txs || []) balance += tx.type === 'withdrawal' ? -tx.amount : tx.amount;

    const interest = Math.round((balance * son.annual_rate / 12) * 100) / 100;
    if (interest <= 0) continue;

    await env.DB.prepare(
      'INSERT INTO transactions (son_id, date, type, amount) VALUES (?, ?, ?, ?)'
    ).bind(son.id, dateStr, 'interest', interest).run();
  }
}

async function runRecurringBookings(env) {
  const now = new Date();
  const dateStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString().slice(0, 10);

  const { results: bookings } = await env.DB.prepare(
    'SELECT id, son_id, type, amount, note FROM recurring_bookings'
  ).all();

  for (const booking of bookings || []) {
    const existing = await env.DB.prepare(
      'SELECT id FROM transactions WHERE son_id = ? AND date = ? AND type = ? AND amount = ? AND note IS ?'
    ).bind(booking.son_id, dateStr, booking.type, booking.amount, booking.note).first();
    if (existing) continue; // schon gebucht (z.B. bei Retry)

    await env.DB.prepare(
      'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(booking.son_id, dateStr, booking.type, booking.amount, booking.note).run();
  }
}
