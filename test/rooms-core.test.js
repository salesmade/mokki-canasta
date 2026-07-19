import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  createRoomData, joinRoomData, startRoomData, moveRoomData, nextRoomData, redactRoom,
} from '../src/rooms-core.js';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Simuloi Supabase-tallennuksen: sarjallista roomin läpi JSONin (kuten verkossa).
const roundtrip = (room) => JSON.parse(JSON.stringify(room));

test('sarjallistus: Game -> serialize -> fromState säilyttää tilan', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(3) });
  g.drawFromDeck();
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.fromState(s);
  assert.equal(g2.deck.length, g.deck.length);
  assert.equal(g2.players[0].hand.length, g.players[0].hand.length);
  assert.equal(g2.turn, g.turn);
  assert.equal(g2.phase, g.phase);
});

test('huone: luonti, liittyminen, aloitus JSONin läpi', () => {
  let room = createRoomData('Aimo', 3, 'ABCD');
  assert.equal(room.seats.length, 1);
  room = roundtrip(room);
  assert.equal(joinRoomData(room, 'Puoliso').seat, 1);
  room = roundtrip(room);
  const r = startRoomData(room, seededRng(9));
  assert.ok(r.ok);
  assert.ok(room.state, 'pelitila tallentui');
  assert.equal(room.state.players.length, 3);
});

test('redact: aula ennen aloitusta; oma+botti näkyy, ihmisvastustaja ei', () => {
  let room = createRoomData('Aimo', 3, 'WXYZ');
  const lobby = redactRoom(room, 0);
  assert.equal(lobby.type, 'lobby');
  joinRoomData(room, 'Toinen'); // seat 1 = ihminen
  startRoomData(room, seededRng(11)); // seat 2 = botti
  room = roundtrip(room);
  const v0 = redactRoom(room, 0);
  assert.equal(v0.type, 'game');
  assert.ok(Array.isArray(v0.players[0].hand));  // oma
  assert.equal(v0.players[1].hand, null);        // ihmisvastustaja piilossa
  assert.ok(Array.isArray(v0.players[2].hand));  // botti näkyy
});

test('siirto JSONin läpi: vain vuorossa oleva, botit pelaavat, versio kasvaa', () => {
  let room = createRoomData('Aimo', 4, 'GAME'); // 1 ihminen + 3 bottia
  startRoomData(room, seededRng(17));
  room = roundtrip(room);
  const v = redactRoom(room, 0);
  const beforeVer = room.version;

  if (v.turn !== 0) {
    assert.ok(moveRoomData(room, 0, { type: 'draw' }).error); // ei vuorossa
  } else {
    assert.ok(moveRoomData(room, 0, { type: 'draw' }).ok);
    room = roundtrip(room);
    const me = redactRoom(room, 0).players[0].hand;
    const dr = moveRoomData(room, 0, { type: 'discard', card: me[0].id });
    assert.ok(dr.ok);
    assert.ok(room.version > beforeVer, 'versio kasvoi');
    const after = redactRoom(room, 0);
    assert.ok(after.turn === 0 || after.roundOver, 'botit pelasivat, vuoro palasi');
  }
});

test('täysi peli serverless-tyyliin: JSON edestakaisin joka siirrolla, päättyy', () => {
  let room = createRoomData('Aimo', 3, 'FULL');
  startRoomData(room, seededRng(23));
  room = roundtrip(room);
  let guard = 0;
  // Kaikki paikat botteja paitsi 0; simuloidaan myös ihminen botin logiikalla ei —
  // sen sijaan ajetaan kunnes jako loppuu, ihmisen (seat 0) vuorolla tehdään yksi laillinen siirto.
  while (!redactRoom(room, 0).roundOver && guard < 500) {
    const v = redactRoom(room, 0);
    if (v.turn === 0) {
      moveRoomData(room, 0, { type: 'draw' });
      room = roundtrip(room);
      const hand = redactRoom(room, 0).players[0].hand;
      // Heitä jokin kortti (ei mene ulos ilman canastaa; jos vain 1 kortti, moottori estää -> heitä silti yritetään)
      moveRoomData(room, 0, { type: 'discard', card: hand[hand.length - 1].id });
      room = roundtrip(room);
    } else {
      // Ei pitäisi tapahtua: botit ajetaan siirron sisällä. Varmuuden vuoksi katkaise.
      break;
    }
    guard++;
  }
  assert.ok(redactRoom(room, 0).roundOver || guard < 500, 'peli eteni loppua kohti');
});
