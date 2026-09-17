// Drei Cron-Trigger (siehe wrangler.toml): Zinsgutschrift an den möglichen Monatsletzten,
// automatische Buchungen (z.B. Taschengeld) + Kontoauszug-Mail am 1. jeden Monats,
// Investitionen täglich.
export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 1 * *') {
      await runRecurringBookings(env);
      await runMonthlyStatementEmails(env);
    } else if (event.cron === '0 22 * * *') {
      await runInvestments(env);
    } else {
      await runMonthlyInterest(env);
    }
  }
};

// 'withdrawal' und 'kest' mindern den Saldo, alle anderen Buchungstypen erhöhen ihn.
const isDebit = type => type === 'withdrawal' || type === 'kest';

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
    for (const tx of txs || []) balance += isDebit(tx.type) ? -tx.amount : tx.amount;

    const grossInterest = Math.round((balance * son.annual_rate / 12) * 100) / 100;
    const kestAmount = Math.round((grossInterest * son.kest_rate) * 100) / 100;
    const netInterest = Math.round((grossInterest - kestAmount) * 100) / 100;
    if (netInterest <= 0) continue;

    // Zinsgutschrift (brutto) und KESt-Abzug als getrennte Buchungen, damit im
    // Kontoauszug/Ledger nachvollziehbar bleibt, wie viel Steuer abgezogen wurde
    // (statt einer bereits verrechneten Netto-Zinsgutschrift).
    const inserts = [
      env.DB.prepare(
        'INSERT INTO transactions (son_id, date, type, amount) VALUES (?, ?, ?, ?)'
      ).bind(son.id, dateStr, 'interest', grossInterest)
    ];
    if (kestAmount > 0) {
      inserts.push(
        env.DB.prepare(
          'INSERT INTO transactions (son_id, date, type, amount, note) VALUES (?, ?, ?, ?, ?)'
        ).bind(son.id, dateStr, 'kest', kestAmount, 'KESt auf Zinsgutschrift')
      );
    }
    await env.DB.batch(inserts);
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
const typeLabels = { deposit: 'Einzahlung', withdrawal: 'Auszahlung', interest: 'Zinsgutschrift', cashback: 'Cashback', kest: 'KESt' };
const monthNames = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const dateFmtDE = isoDate => {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
};

// Farben/Optik an public/css/style.css angelehnt (Sandstone/Sea-Palette,
// "Stamp Card"-Look), inline gestylt weil E-Mail-Clients kein <style>/CSS-
// Variablen/Custom-Fonts zuverlässig unterstützen.
const EMAIL_COLORS = {
  bg: '#FAF3E3', paper: '#FFFFFF', ink: '#142E2A', sea: '#20948B', rust: '#DE7A22'
};

function buildStatementHtml({ sonName, monthLabel, rangeStart, rangeEnd, startBalance, endBalance, monthTxs }) {
  const c = EMAIL_COLORS;
  const rows = monthTxs.length
    ? monthTxs.map(tx => {
        const debit = isDebit(tx.type);
        const color = debit ? c.rust : c.sea;
        const sign = debit ? '−' : '+';
        const label = typeLabels[tx.type] || tx.type;
        const note = tx.note ? ` <span style="color:${c.ink};opacity:0.6;">(${escapeHtml(tx.note)})</span>` : '';
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px dashed rgba(20,46,42,0.15);font-size:13px;color:${c.ink};">${dateFmtDE(tx.date)}</td>
          <td style="padding:8px 0;border-bottom:1px dashed rgba(20,46,42,0.15);font-size:13px;color:${color};">${label}${note}</td>
          <td style="padding:8px 0;border-bottom:1px dashed rgba(20,46,42,0.15);font-size:13px;color:${color};text-align:right;white-space:nowrap;">${sign} ${eur(tx.amount)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:${c.ink};opacity:0.6;">(keine Bewegungen)</td></tr>`;

  return `<div style="background:${c.bg};padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:${c.ink};">
    <div style="max-width:480px;margin:0 auto;background:${c.paper};border-radius:4px;padding:32px;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${c.sea};">
        Kontoauszug &middot; ${monthLabel}
      </div>
      <div style="font-size:26px;font-weight:700;margin:8px 0 24px;">${escapeHtml(sonName)}</div>

      <div style="font-family:'Courier New',monospace;font-size:12px;color:${c.sea};margin-bottom:2px;">Kontostand am ${dateFmtDE(rangeStart)}</div>
      <div style="font-size:20px;font-weight:600;margin-bottom:24px;">${eur(startBalance)}</div>

      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:0 0 6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${c.sea};border-bottom:1px solid rgba(32,148,139,0.3);">Datum</th>
            <th style="text-align:left;padding:0 0 6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${c.sea};border-bottom:1px solid rgba(32,148,139,0.3);">Art</th>
            <th style="text-align:right;padding:0 0 6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${c.sea};border-bottom:1px solid rgba(32,148,139,0.3);">Betrag</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="font-family:'Courier New',monospace;font-size:12px;color:${c.sea};margin:24px 0 2px;">Kontostand am ${dateFmtDE(rangeEnd)}</div>
      <div style="font-size:24px;font-weight:700;">${eur(endBalance)}</div>

      <div style="font-family:'Courier New',monospace;font-size:11px;color:${c.ink};opacity:0.6;margin-top:28px;line-height:1.5;">
        Gebundene Investitionen sind in diesem Auszug nicht enthalten.
      </div>
    </div>
  </div>`;
}

async function sendEmail(env, { to, cc, subject, text, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Dein Kapital <onboarding@resend.dev>',
        to: [to],
        cc: cc || [],
        subject,
        text,
        html
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

const ADMIN_EMAIL = 'okeszler@gmail.com';

// Resend erlaubt beim unverifizierten "onboarding@resend.dev"-Absender NUR
// Versand an die eigene Account-Adresse (ADMIN_EMAIL) — Sends an andere
// Empfänger werden mit 403 abgelehnt. Bis eine eigene Domain bei Resend
// verifiziert ist, gehen alle Kontoauszüge deshalb an ADMIN_EMAIL statt an
// die jeweilige Person. Auf false stellen, sobald die Domain steht.
const REDIRECT_STATEMENTS_TO_ADMIN = true;

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
      const signed = isDebit(tx.type) ? -tx.amount : tx.amount;
      if (tx.date < rangeStart) {
        startBalance += signed;
      } else if (tx.date <= rangeEnd) {
        monthTxs.push(tx);
      }
    }
    const endBalance = monthTxs.reduce(
      (sum, tx) => sum + (isDebit(tx.type) ? -tx.amount : tx.amount), startBalance
    );

    const lines = monthTxs.length
      ? monthTxs.map(tx => {
          const sign = isDebit(tx.type) ? '-' : '+';
          const label = typeLabels[tx.type] || tx.type;
          const note = tx.note ? ` (${tx.note})` : '';
          return `${tx.date}  ${label}${note}: ${sign}${eur(tx.amount)}`;
        }).join('\n')
      : '(keine Bewegungen)';

    const redirectNote = REDIRECT_STATEMENTS_TO_ADMIN
      ? `[Weiterleitung an Papi — Resend erlaubt noch keinen Direktversand an ${son.email}, bis eine eigene Domain verifiziert ist.]\n\n`
      : '';

    const text = redirectNote +
      `Kontoauszug FLEX-Konto für ${son.name} — ${monthLabel}\n\n` +
      `Kontostand am ${rangeStart}: ${eur(Math.round(startBalance * 100) / 100)}\n\n` +
      `Bewegungen:\n${lines}\n\n` +
      `Kontostand am ${rangeEnd}: ${eur(Math.round(endBalance * 100) / 100)}\n\n` +
      `(Gebundene Investitionen sind in diesem Auszug nicht enthalten.)`;

    const html = buildStatementHtml({
      sonName: son.name,
      monthLabel,
      rangeStart,
      rangeEnd,
      startBalance: Math.round(startBalance * 100) / 100,
      endBalance: Math.round(endBalance * 100) / 100,
      monthTxs
    });

    await sendEmail(env, REDIRECT_STATEMENTS_TO_ADMIN
      ? {
          to: ADMIN_EMAIL,
          subject: `[${son.name}] Kontoauszug ${monthLabel}`,
          text,
          html
        }
      : {
          to: son.email,
          cc: [ADMIN_EMAIL],
          subject: `Kontoauszug ${monthLabel} — ${son.name}`,
          text,
          html
        });
  }
}
