import { requireSonSession, json } from '../_shared.js';

const PALETTES = ['blau', 'pflaume', 'graphit', 'bordeaux'];

// Persönliche Anzeige-Einstellungen, die jede Person selbst ändern darf.
export async function onRequestPost({ request, env }) {
  const session = await requireSonSession(request, env);
  if (!session) return json({ error: 'Nicht eingeloggt' }, { status: 401 });

  const { palette } = await request.json();
  if (!PALETTES.includes(palette)) return json({ error: 'Unbekanntes Farbschema' }, { status: 400 });

  await env.DB.prepare('UPDATE sons SET palette = ? WHERE id = ?').bind(palette, session.sonId).run();
  return json({ ok: true });
}
