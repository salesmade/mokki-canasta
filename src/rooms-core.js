// Serverless-huoneiden ydinlogiikka: TILATON. Huone on pelkkää dataa (menee Supabaseen).
// Jokainen funktio: (room, ...) -> mutatoi roomia + palauttaa tuloksen. Ei muistia, ei verkkoa.
import { Game } from './game.js';
import { botPlayTurn } from './bot.js';
import { viewFor, cleanName, makeCode } from './online.js';

export { makeCode, cleanName };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

function runBots(g) {
  let guard = 0;
  while (!g.roundOver && g.players[g.turn].isBot && guard < 500) { botPlayTurn(g); guard++; }
}

// Uusi huone (host = paikka 0). Koodi annetaan ulkoa (törmäystarkistus tehdään storessa).
export function createRoomData(hostName, seatCount, code) {
  return {
    code,
    seatCount: clamp(seatCount || 4, 2, 4),
    seats: [{ name: cleanName(hostName), isBot: false }],
    state: null,
    version: 1,
  };
}

export function joinRoomData(room, name) {
  if (room.state) return { error: 'Peli on jo alkanut' };
  if (room.seats.length >= room.seatCount) return { error: 'Huone täynnä' };
  room.seats.push({ name: cleanName(name), isBot: false });
  room.version++;
  return { seat: room.seats.length - 1 };
}

export function startRoomData(room, rng, startScores = null) {
  if (room.state) return { error: 'Peli on jo alkanut' };
  const players = [];
  for (let i = 0; i < room.seatCount; i++) {
    const s = room.seats[i];
    if (s) players.push({ name: s.name, isBot: !!s.isBot });
    else { const b = { name: `Botti ${i}`, isBot: true }; players.push(b); room.seats[i] = b; }
  }
  const g = new Game({ players, rng, startScores });
  runBots(g);
  room.state = g.serialize();
  room.version++;
  return { ok: true };
}

export function moveRoomData(room, seat, move) {
  if (!room.state) return { error: 'Ei peliä' };
  const g = Game.fromState(room.state);
  if (g.roundOver) return { error: 'Jako on päättynyt' };
  if (g.turn !== seat) return { error: 'Ei sinun vuorosi' };
  let r;
  switch (move && move.type) {
    case 'draw': r = g.drawFromDeck(); break;
    case 'take': r = g.takeDiscard(move.cards || []); break;
    case 'meld': r = g.meld(move.groups || []); break;
    case 'discard': r = g.discardCard(move.card); break;
    default: return { error: 'Tuntematon siirto' };
  }
  if (!r.ok) return r;
  runBots(g);
  room.state = g.serialize();
  room.version++;
  return { ok: true };
}

export function nextRoomData(room, rng) {
  if (!room.state) return { error: 'Ei peliä' };
  const g = Game.fromState(room.state);
  const startScores = g.teams.map((t) => t.score);
  const players = g.players.map((p) => ({ name: p.name, isBot: p.isBot }));
  const ng = new Game({ players, rng, startScores });
  runBots(ng);
  room.state = ng.serialize();
  room.version++;
  return { ok: true };
}

// Pelaajakohtainen (sensuroitu) näkymä pollausta varten.
export function redactRoom(room, seat) {
  if (!room.state) {
    return {
      type: 'lobby', code: room.code, seatCount: room.seatCount, version: room.version,
      seats: room.seats.map((s) => ({ name: s.name, isBot: !!s.isBot })), you: seat,
    };
  }
  return { type: 'game', code: room.code, version: room.version, ...viewFor(Game.fromState(room.state), seat) };
}
