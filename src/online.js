// Moninpelin serverilogiikka: huoneet + pelaajakohtainen (sensuroitu) nakyma.
// Serveri omistaa koko pelitilan; kukin pelaaja saa vain oman katensa taytena.
import { Game } from './game.js';
import { botPlayTurn } from './bot.js';
import { isCanasta } from './melds.js';

// 4-merkkinen huonekoodi ilman sekaannuskirjaimia.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

// Turvallinen nimi (estä XSS ja pituus).
export function cleanName(name) {
  return String(name || 'Pelaaja').replace(/[<>&"']/g, '').slice(0, 20).trim() || 'Pelaaja';
}

// Rakentaa yhden pelaajan nakyman pelista. seat = pelaajan indeksi (tai null katsojalle).
export function viewFor(game, seat) {
  const top = game.topDiscard();
  return {
    seat,
    phase: game.phase,
    turn: game.turn,
    frozen: game.frozen,
    roundOver: game.roundOver,
    wentOutPlayer: game.wentOutPlayer,
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    discardTop: top,
    players: game.players.map((p, i) => ({
      seat: i,
      name: p.name,
      isBot: p.isBot,
      teamId: p.teamId,
      handCount: p.hand.length,
      // Vain oma kasi paljastetaan.
      hand: i === seat ? p.hand : null,
    })),
    teams: game.teams.map((t) => ({
      id: t.id,
      playerIdxs: t.playerIdxs,
      melds: Object.fromEntries(
        Object.entries(t.melds).map(([r, m]) => [r, { cards: m, canasta: isCanasta(m) }])),
      redThrees: t.redThrees,
      hasOpened: t.hasOpened,
      score: t.score,
    })),
    log: game.log.slice(-6),
  };
}

// Huoneiden hallinta. Pitaa pelitilan muistissa; ei tietokantaa (peli kestaa minuutteja).
export class RoomManager {
  constructor(rng = Math.random) {
    this.rooms = new Map();
    this.rng = rng;
  }

  createRoom(hostName, seatCount = 4) {
    let code = makeCode(this.rng);
    while (this.rooms.has(code)) code = makeCode(this.rng);
    const room = {
      code,
      seatCount: Math.max(2, Math.min(4, seatCount)),
      seats: [{ name: cleanName(hostName), isBot: false, connected: false }],
      game: null,
      subscribers: new Set(), // { seat, send(fn) }
      startScores: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase()); }

  // Liity huoneeseen ihmisena. Palauttaa { seat } tai { error }.
  join(code, name) {
    const room = this.get(code);
    if (!room) return { error: 'Huonetta ei löydy' };
    if (room.game) return { error: 'Peli on jo alkanut' };
    if (room.seats.length >= room.seatCount) return { error: 'Huone täynnä' };
    room.seats.push({ name: cleanName(name), isBot: false, connected: false });
    return { seat: room.seats.length - 1, code: room.code };
  }

  // Aloita peli: tayta tyhjat paikat boteilla ja jaa kortit.
  start(code) {
    const room = this.get(code);
    if (!room) return { error: 'Huonetta ei löydy' };
    if (room.game) return { error: 'Peli on jo alkanut' };
    const players = [];
    for (let i = 0; i < room.seatCount; i++) {
      const s = room.seats[i];
      if (s) players.push({ name: s.name, isBot: false });
      else { players.push({ name: `Botti-${i}`, isBot: true }); room.seats[i] = { name: `Botti-${i}`, isBot: true }; }
    }
    room.game = new Game({ players, rng: this.rng, startScores: room.startScores });
    this._runBots(room);
    return { ok: true };
  }

  // Uusi jako samoilla pelaajilla, pisteet sailyvat.
  nextRound(code) {
    const room = this.get(code);
    if (!room || !room.game) return { error: 'Ei peliä' };
    room.startScores = room.game.teams.map((t) => t.score);
    const players = room.game.players.map((p) => ({ name: p.name, isBot: p.isBot }));
    room.game = new Game({ players, rng: this.rng, startScores: room.startScores });
    this._runBots(room);
    return { ok: true };
  }

  // Suorita siirto. Vain vuorossa oleva pelaaja saa toimia.
  move(code, seat, move) {
    const room = this.get(code);
    if (!room || !room.game) return { error: 'Ei peliä' };
    const g = room.game;
    if (g.roundOver) return { error: 'Jako on päättynyt' };
    if (g.turn !== seat) return { error: 'Ei sinun vuorosi' };

    let r;
    switch (move.type) {
      case 'draw': r = g.drawFromDeck(); break;
      case 'take': r = g.takeDiscard(move.cards || []); break;
      case 'meld': r = g.meld(move.groups || []); break;
      case 'discard': r = g.discardCard(move.card); break;
      default: return { error: 'Tuntematon siirto' };
    }
    if (!r.ok) return r;
    this._runBots(room);
    return { ok: true };
  }

  // Aja bottien vuorot kunnes ihmisen vuoro tai jako loppui.
  _runBots(room) {
    const g = room.game;
    let guard = 0;
    while (!g.roundOver && g.players[g.turn].isBot && guard < 500) {
      botPlayTurn(g);
      guard++;
    }
  }
}
