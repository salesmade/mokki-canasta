// Supabase-tallennus REST:n kautta (ei kirjastoriippuvuutta). Yksi taulu: canasta_rooms.
// Taulu: code text primary key, data jsonb, updated_at timestamptz.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, (CANASTA_TABLE=canasta_rooms).
export function supabaseStore(env = process.env) {
  const URL = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  const TABLE = env.CANASTA_TABLE || 'canasta_rooms';
  if (!URL || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY puuttuu');
  const headers = {
    apikey: KEY,
    authorization: `Bearer ${KEY}`,
    'content-type': 'application/json',
  };

  return {
    async getRoom(code) {
      const c = String(code || '').toUpperCase();
      const res = await fetch(`${URL}/rest/v1/${TABLE}?code=eq.${encodeURIComponent(c)}&select=data`, { headers });
      if (!res.ok) throw new Error('Supabase get virhe ' + res.status);
      const rows = await res.json();
      return rows[0]?.data || null;
    },
    async saveRoom(room) {
      // Upsert code-avaimella.
      const res = await fetch(`${URL}/rest/v1/${TABLE}?on_conflict=code`, {
        method: 'POST',
        headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ code: room.code, data: room, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Supabase save virhe ' + res.status);
    },
  };
}
