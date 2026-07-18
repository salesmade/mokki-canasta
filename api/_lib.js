// Yhteinen apuri Vercel-funktioille: rakentaa API:n Supabase-storella + lukee bodyn.
import { makeApi } from '../src/api-handlers.js';
import { supabaseStore } from '../src/store-supabase.js';

export function api() {
  return makeApi(supabaseStore());
}

// Vercel jäsentää JSON-bodyn yleensä valmiiksi; varmistetaan silti.
export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export function send(res, obj) {
  res.status(obj && obj.error ? 400 : 200).json(obj);
}
