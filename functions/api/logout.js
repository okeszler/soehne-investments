import { clearCookieHeader, json } from '../_shared.js';

export async function onRequestPost() {
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookieHeader('son_session'));
  headers.append('Set-Cookie', clearCookieHeader('admin_session'));
  return json({ ok: true }, { headers });
}
