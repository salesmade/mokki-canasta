import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, viewFor, cleanName, makeCode } from '../src/online.js';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test('nimen puhdistus estaa XSS-merkit ja rajaa pituuden', () => {
  assert.equal(cleanName('<script>Anneli'), 'scriptAnneli');
  assert.equal(cleanName(''), 'Pelaaja');
  assert.equal(cleanName('x'.repeat(40)).length, 20);
});

test('huonekoodi on 4 merkkia sallituista', () => {
  const code = makeCode(seededRng(1));
  assert.equal(code.length, 4);
  assert.match(code, /^[A-Z2-9]{4}$/);
});

test('huoneen luonti, liittyminen ja tayttyminen', () => {
  const rm = new RoomManager(seededRng(5));
  const room = rm.createRoom('Sinä', 3);
  assert.equal(room.seats.length, 1);
  assert.equal(rm.join(room.code, 'Puoliso').seat, 1);
  assert.equal(rm.join(room.code, 'Anneli').seat, 2);
  // Neljas ei mahdu (seatCount 3)
  assert.ok(rm.join(room.code, 'Liikaa').error);
});

test('tuntematon koodi antaa virheen', () => {
  const rm = new RoomManager(seededRng(5));
  assert.ok(rm.join('ZZZZ', 'X').error);
});

test('start tayttaa tyhjat paikat boteilla', () => {
  const rm = new RoomManager(seededRng(9));
  const room = rm.createRoom('Sinä', 4); // vain 1 ihminen
  rm.start(room.code);
  assert.ok(room.game);
  assert.equal(room.game.players.length, 4);
  assert.equal(room.game.players.filter((p) => p.isBot).length, 3);
});

test('viewFor: oma + bottien kädet näkyvät, ihmisvastustajan ei', () => {
  const rm = new RoomManager(seededRng(11));
  const room = rm.createRoom('Sinä', 3);
  rm.join(room.code, 'Ihminen'); // seat 1 = ihminen
  rm.start(room.code);           // seat 2 = botti
  const v0 = viewFor(room.game, 0);
  assert.ok(Array.isArray(v0.players[0].hand)); // oma näkyy
  assert.equal(v0.players[1].hand, null);       // ihmisvastustaja piilossa
  assert.ok(Array.isArray(v0.players[2].hand)); // botti näkyy
  assert.ok(v0.players[1].handCount > 0);       // ihmisestä vain lukumäärä
});

test('vain vuorossa oleva saa siirtaa', () => {
  const rm = new RoomManager(seededRng(13));
  const room = rm.createRoom('Sinä', 2);
  rm.start(room.code);
  const g = room.game;
  const notTurn = (g.turn + 1) % 2;
  assert.ok(rm.move(room.code, notTurn, { type: 'draw' }).error);
  assert.ok(rm.move(room.code, g.turn, { type: 'draw' }).ok);
});

test('siirron jalkeen botit pelaavat vuoronsa kunnes ihmisen vuoro', () => {
  const rm = new RoomManager(seededRng(17));
  const room = rm.createRoom('Sinä', 4); // 1 ihminen + 3 bottia
  rm.start(room.code);
  const g = room.game;
  // Ihminen on paikka 0. Botit paikat 1-3. Pelaa ihmisen vuoro loppuun.
  if (g.turn === 0) {
    rm.move(room.code, 0, { type: 'draw' });
    const me = g.players[0];
    rm.move(room.code, 0, { type: 'discard', card: me.hand[0].id });
  }
  // Botit ovat pelanneet: vuoro on taas ihmisella tai jako loppui.
  assert.ok(g.turn === 0 || g.roundOver);
});
