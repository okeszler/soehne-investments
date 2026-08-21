// Vier Cron-Trigger (siehe wrangler.toml): Zinsgutschrift an den möglichen Monatsletzten,
// automatische Buchungen (z.B. Taschengeld) am 1. jeden Monats, Investitionen täglich,
// Kontoauszug-Mail am 1. jeden Monats.
export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 1 * *') {
      await runRecurringBookings(env);
    } else if (event.cron === '0 22 * * *') {
      await runInvestments(env);
    } else if (event.cron === '0 7 1 * *') {
      await runMonthlyStatementEmails(env);
    } else {
      await runMonthlyInterest(env);
    }
  }
};

// "maturity" (endfällig) bekommt nie eine Zwischen-Gutschrift (periodDays = Infinity,
// die Schleife unten macht dann immer "continue") — die gesamte Laufzeit-Verzinsung
// wird erst im Fälligkeits-Zweig auf einmal mit dem Kapital ausgezahlt.
const PERIOD_DAYS = { monthly: 30, quarterly: 91, yearly: 365, maturity: Infinity };

// Läuft täglich: bucht periodische Zinsen je Produkt-Intervall auf die gesperrte
// Investition, und überweist bei Ablauf der Bindungsfrist Kapital + Zinsen als eine
// Buchung zurück aufs Cashflow-Konto (transactions).
async function runInvestments(env) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayStr = today.toISOString().slice(0, 10);

  const { results: investments } = await env.DB.prepare(
    `SELECT i.id, i.son_id, i.balance, i.maturity_date, i.last_credit_date,
            p.name as product_name, p.apy, p.interest_frequency, s.kest_rate
     FROM investments i
     JOIN products p ON p.id = i.product_id
     JOIN sons s ON s.id = i.son_id
     WHERE i.status = 'active'`
  ).all();

  for (const inv of investments || []) {
    const elapsedDays = Math.floor((today - new Date(inv.last_credit_date + 'T00:00:00Z')) / 86400000);
    let balance = inv.balance;
    if (elapsedDays > 0) {
      const interest = Math.round((inv.balance * inv.apy * elapsedDays / 365) * 100) / 100;
      const netInterest = Math.round((interest * (1 - inv.kest_rate)) * 100) / 100;
      balance = Math.round((inv.balance + netInterest) * 100) / 100;
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

  const { results: sons } = await env.DB.prepare('SELECT id, annual_rate, kest_rate FROM sons').all();

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

    const grossInterest = balance * son.annual_rate / 12;
    const interest = Math.round((grossInterest * (1 - son.kest_rate)) * 100) / 100;
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

const eur = n => `${n.toFixed(2).replace('.', ',')} €`;
const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift' };
const monthNames = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

async function sendEmail(env, { to, cc, subject, text }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Söhne-Investment <onboarding@resend.dev>',
        to: [to],
        cc: cc || [],
        subject,
        text
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Läuft am 1. jeden Monats: schickt jeder Person mit hinterlegter E-Mail-Adresse
// einen Kontoauszug der FLEX-Bewegungen des VERGANGENEN Monats (Kopie an Papi).
async function runMonthlyStatementEmails(env) {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthEnd = new Date(firstOfThisMonth);
  lastMonthEnd.setUTCDate(lastMonthEnd.getUTCDate() - 1);
  const firstOfLastMonth = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));

  const rangeStart = firstOfLastMonth.toISOString().slice(0, 10);
  const rangeEnd = lastMonthEnd.toISOString().slice(0, 10);
  const monthLabel = `${monthNames[firstOfLastMonth.getUTCMonth()]} ${firstOfLastMonth.getUTCFullYear()}`;

  const { results: sons } = await env.DB.prepare(
    "SELECT id, name, email FROM sons WHERE email IS NOT NULL AND email != ''"
  ).all();

  for (const son of sons || []) {
    const { results: txs } = await env.DB.prepare(
      'SELECT date, type, amount, note FROM transactions WHERE son_id = ? ORDER BY date ASC, id ASC'
    ).bind(son.id).all();

    let startBalance = 0;
    const monthTxs = [];
    for (const tx of txs || []) {
      const signed = tx.type === 'withdrawal' ? -tx.amount : tx.amount;
      if (tx.date < rangeStart) {
        startBalance += signed;
      } else if (tx.date <= rangeEnd) {
        monthTxs.push(tx);
      }
    }
    const endBalance = monthTxs.reduce(
      (sum, tx) => sum + (tx.type === 'withdrawal' ? -tx.amount : tx.amount), startBalance
    );

    const lines = monthTxs.length
      ? monthTxs.map(tx => {
          const sign = tx.type === 'withdrawal' ? '-' : '+';
          const label = typeLabels[tx.type] || tx.type;
          const note = tx.note ? ` (${tx.note})` : '';
          return `${tx.date}  ${label}${note}: ${sign}${eur(tx.amount)}`;
        }).join('\n')
      : '(keine Bewegungen)';

    const text =
      `Kontoauszug FLEX-Konto für ${son.name} — ${monthLabel}\n\n` +
      `Kontostand am ${rangeStart}: ${eur(Math.round(startBalance * 100) / 100)}\n\n` +
      `Bewegungen:\n${lines}\n\n` +
      `Kontostand am ${rangeEnd}: ${eur(Math.round(endBalance * 100) / 100)}\n\n` +
      `(Gebundene Investitionen sind in diesem Auszug nicht enthalten.)`;

    await sendEmail(env, {
      to: son.email,
      cc: ['okeszler@gmail.com'],
      subject: `Kontoauszug ${monthLabel} — ${son.name}`,
      text
    });
  }
}
