// Funktioiden yhteinen apuri (LÄHDE). esbuild bundlaa tämän + src:n api/*.js:aan itsenäisiksi.
import { makeApi } from '../src/api-handlers.js';
import { supabaseStore } from '../src/store-supabase.js';

export function api() {
  return makeApi(supabaseStore());
}

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export function send(res, obj) {
  res.status(obj && obj.error ? 400 : 200).json(obj);
}

// Virhe lokitetaan serverille; asiakkaalle vain geneerinen viesti (ei stackia).
export async function run(res, fn) {
  try { send(res, await fn()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Sisäinen virhe' }); }
}
