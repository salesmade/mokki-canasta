// Muistitallennus — paikalliseen kehitykseen ja testeihin (ei Supabasea).
export function memoryStore() {
  const rooms = new Map();
  return {
    async getRoom(code) {
      const r = rooms.get(String(code || '').toUpperCase());
      return r ? JSON.parse(JSON.stringify(r)) : null; // kopio = kuten verkon yli
    },
    async saveRoom(room) {
      rooms.set(room.code, JSON.parse(JSON.stringify(room)));
    },
  };
}
