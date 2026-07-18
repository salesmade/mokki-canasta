// Jaetut API-käsittelijät: sama logiikka paikallisessa serverissä JA Vercel-funktioissa.
// Riippuu vain storesta (getRoom/saveRoom), joten testattavissa muistitallennuksella.
import {
  createRoomData, joinRoomData, startRoomData, moveRoomData, nextRoomData, redactRoom, makeCode,
} from './rooms-core.js';

export function makeApi(store, rng = Math.random) {
  return {
    async create({ name, seats } = {}) {
      let code;
      do { code = makeCode(rng); } while (await store.getRoom(code));
      const room = createRoomData(name, seats, code);
      await store.saveRoom(room);
      return { code, seat: 0 };
    },

    async join({ code, name } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: 'Huonetta ei löydy' };
      const r = joinRoomData(room, name);
      if (r.error) return r;
      await store.saveRoom(room);
      return { code: room.code, seat: r.seat };
    },

    async start({ code } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: 'Huonetta ei löydy' };
      const r = startRoomData(room, rng);
      if (r.error) return r;
      await store.saveRoom(room);
      return { ok: true };
    },

    async next({ code } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: 'Huonetta ei löydy' };
      const r = nextRoomData(room, rng);
      if (r.error) return r;
      await store.saveRoom(room);
      return { ok: true };
    },

    async move({ code, seat, move } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: 'Huonetta ei löydy' };
      const r = moveRoomData(room, Number(seat), move);
      if (r.error) return r;
      await store.saveRoom(room);
      // Palauta heti tekijän oma näkymä (ei tarvitse pollata omalla vuorolla).
      return { ok: true, view: redactRoom(room, Number(seat)) };
    },

    async state({ code, seat } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: 'Huonetta ei löydy' };
      return redactRoom(room, Number(seat));
    },
  };
}
