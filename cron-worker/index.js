// Monatliche Zinsgutschrift: läuft an den möglichen Monatsletzten (siehe wrangler.toml crons),
// bucht aber nur, wenn der Folgetag tatsächlich der 1. eines Monats ist.
export default {
  async scheduled(event, env, ctx) {
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
};
