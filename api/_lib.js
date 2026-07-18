// Yhteinen apuri Vercel-funktioille. src ladataan DYNAAMISESTI, jotta mahd. latausvirhe
// saadaan try/catchiin (ei FUNCTION_INVOCATION_FAILED-kaatumista).
export async function api() {
  const { makeApi } = await import('../src/api-handlers.js');
  const { supabaseStore } = await import('../src/store-supabase.js');
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

// Kääre: suorittaa funktion ja palauttaa virheen stackin JSON:na (debug).
export async function run(res, fn) {
  try { send(res, await fn()); }
  catch (e) { res.status(500).json({ error: String((e && e.stack) || e) }); }
}
