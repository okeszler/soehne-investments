import { json } from '../_shared.js';

export async function onRequestGet({ env }) {
  return json({ publicKey: env.VAPID_PUBLIC_KEY });
}
