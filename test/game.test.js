import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { isRedThree } from '../src/cards.js';

// Deterministinen rng testeihin.
function seededRng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const card = (rank, suit, n) => ({ rank, suit, id: `${rank}-${suit}-${n}` });

// Laskee kaikki pelissa olevat kortit (pitaa aina olla 108).
function countCards(g) {
  let n = g.deck.length + g.discard.length;
  for (const p of g.players) n += p.hand.length;
  for (const t of g.teams) {
    for (const m of Object.values(t.melds)) n += m.length;
    n += t.redThrees; // punaiset syrjaan otetut
  }
  return n;
}

test('jako: oikea korttimaara ja kasikoot sailyy (108)', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], rng: seededRng(7) });
  assert.equal(countCards(g), 108);
  for (const p of g.players) assert.ok(p.hand.length >= 13); // 3p = 13 (+ mahd. korvatut)
  assert.ok(g.players.every((p) => !p.hand.some(isRedThree))); // ei punaisia kadessa
});

test('4 pelaajaa -> parit (0,2) ja (1,3)', () => {
  const g = new Game({ players: [{}, {}, {}, {}], rng: seededRng(3) });
  assert.equal(g.teams.length, 2);
  assert.deepEqual(g.teams[0].playerIdxs, [0, 2]);
  assert.deepEqual(g.teams[1].playerIdxs, [1, 3]);
  assert.equal(g.players[0].hand.length >= 11, true);
});

test('nosto pakasta siirtaa toimintavaiheeseen', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(5) });
  assert.equal(g.phase, 'draw');
  const before = g.current().hand.length;
  const r = g.drawFromDeck();
  assert.ok(r.ok);
  assert.equal(g.phase, 'action');
  assert.ok(g.current().hand.length >= before); // +1 (tai enemman jos punaisia)
});

test('avaus hylataan alle rajan, hyvaksytaan rajalla', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(9) });
  g.phase = 'action';
  const p = g.current();
  // 3 kuningasta = 30 p (< 50) -> hylkays
  p.hand = [card('K', 'H', 1), card('K', 'S', 1), card('K', 'D', 1), card('A', 'H', 1)];
  let r = g.meld([[p.hand[0].id, p.hand[1].id, p.hand[2].id]]);
  assert.equal(r.ok, false);
  // 3 assaa = 60 p (>= 50) -> ok. Kädessä myös 2 muuta korttia (jää heittovaraa).
  p.hand = [card('A', 'H', 1), card('A', 'S', 1), card('A', 'D', 1), card('4', 'C', 1), card('5', 'C', 1)];
  r = g.meld([[p.hand[0].id, p.hand[1].id, p.hand[2].id]]);
  assert.ok(r.ok, r.error);
  assert.equal(g.teamOf(0).hasOpened, true);
  assert.equal(g.teamOf(0).melds['A'].length, 3);
});

test('heitto vaihtaa vuoron', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(11) });
  g.drawFromDeck();
  const throwing = g.turn;
  const cardId = g.current().hand[0].id;
  const r = g.discardCard(cardId);
  assert.ok(r.ok, r.error);
  assert.notEqual(g.turn, throwing);
  assert.equal(g.phase, 'draw');
});

test('ei voi menna ulos ilman canastaa', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(13) });
  g.phase = 'action';
  g.turn = 0;
  g.players[0].hand = [card('K', 'H', 1)]; // viimeinen kortti
  const r = g.discardCard('K-H-1');
  assert.equal(r.ok, false);
  assert.match(r.error, /canasta/);
});

test('ulos meno canastalla: pisteet lasketaan (canasta 500 + pohjat 100)', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(17) });
  g.phase = 'action';
  g.turn = 0;
  const team = g.teamOf(0);
  team.hasOpened = true;
  g.turnOpenedStart = true; // avasi jo aiemmalla vuorolla -> ei piilo-ulostulo
  // Puhdas 7:n canasta pöydassa
  team.melds['7'] = [1, 2, 3, 4, 5, 6, 7].map((n) => card('7', 'H', n));
  g.players[0].hand = [card('9', 'H', 1)]; // heitetaan viimeinen -> ulos
  const r = g.discardCard('9-H-1');
  assert.ok(r.ok, r.error);
  assert.equal(r.roundOver, true);
  const t0 = r.results.find((x) => x.teamId === 0);
  // 7*5=35 + canasta 500 = 535 sarjat, + 100 pohjat = 635, kasi 0
  assert.equal(t0.total, 535 + 100);
});

test('poistopinon nosto: top + pari kadesta sarjaksi, loput kateen', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(19) });
  g.turn = 0;
  g.phase = 'draw';
  g.frozen = false;
  const team = g.teamOf(0);
  team.hasOpened = true; // ei avausrajaa
  // Pino: pohjalla roska, paalla kuningas
  g.discard = [card('4', 'C', 1), card('9', 'D', 1), card('K', 'H', 1)];
  g.players[0].hand = [card('K', 'S', 1), card('K', 'D', 1), card('2', 'H', 1)];
  const before = countCards(g);
  const r = g.takeDiscard(['K-S-1', 'K-D-1']);
  assert.ok(r.ok, r.error);
  assert.equal(g.phase, 'action');
  assert.equal(team.melds['K'].length, 3); // top + 2 kadesta
  // Loput pinosta (4,9) siirtyivat kateen
  assert.ok(g.players[0].hand.some((c) => c.rank === '4'));
  assert.ok(g.players[0].hand.some((c) => c.rank === '9'));
  assert.equal(countCards(g), before);
});

test('musta kolmonen: esto ilman ulos menoa, sallittu lopettaessa canastalla', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(41) });
  g.phase = 'action';
  g.turn = 0;
  const team = g.teamOf(0);
  team.hasOpened = true;
  // Ei canastaa: 3 mustaa kolmosta + muuta -> esto
  g.players[0].hand = [card('3', 'S', 1), card('3', 'C', 1), card('3', 'S', 2), card('9', 'H', 1), card('9', 'S', 1)];
  let r = g.meld([['3-S-1', '3-C-1', '3-S-2']]);
  assert.equal(r.ok, false);
  assert.match(r.error, /lopettaessa|kolmoset/i);
  // Canasta pöydässä + jää 1 heittokortti -> sallittu
  team.melds['7'] = [1, 2, 3, 4, 5, 6, 7].map((n) => card('7', 'H', n));
  g.players[0].hand = [card('3', 'S', 1), card('3', 'C', 1), card('3', 'S', 2), card('9', 'H', 1)];
  r = g.meld([['3-S-1', '3-C-1', '3-S-2']]);
  assert.ok(r.ok, r.error);
  assert.equal(g.teamOf(0).melds['3'].length, 3);
});

test('piilo-ulostulo: avaus + ulos samalla vuorolla = 200 bonus', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(43) });
  g.phase = 'action';
  g.turn = 0;
  g.turnOpenedStart = false; // ei avattu ennen tätä vuoroa
  const team = g.teamOf(0);
  team.hasOpened = true; // avasi tänä vuorona
  team.melds['K'] = [1, 2, 3, 4, 5, 6, 7].map((n) => card('K', 'S', n)); // canasta
  g.players[0].hand = [card('9', 'H', 1)];
  const r = g.discardCard('9-H-1');
  assert.ok(r.ok, r.error);
  const t0 = r.results.find((x) => x.teamId === 0);
  assert.equal(t0.goOutBonus, 200);
});

test('umpikuja-esto: ei saa laskea kättä alle 2 kortin ilman canastaa', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(31) });
  g.phase = 'action';
  g.turn = 0;
  g.teamOf(0).hasOpened = true;
  // 4 korttia: kolme 9:ää + A. Laskisi 9:t -> jäisi 1 (A), ei canastaa -> esto.
  g.players[0].hand = [card('9', 'H', 1), card('9', 'S', 1), card('9', 'D', 1), card('A', 'C', 1)];
  const r = g.meld([['9-H-1', '9-S-1', '9-D-1']]);
  assert.equal(r.ok, false);
  assert.match(r.error, /2 korttia|canasta/);
  assert.equal(g.players[0].hand.length, 4); // ei muuttunut
});

test('canastan kanssa saa laskea kättä 1 korttiin (ulos meno ok)', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(33) });
  g.phase = 'action';
  g.turn = 0;
  const team = g.teamOf(0);
  team.hasOpened = true;
  team.melds['7'] = [1, 2, 3, 4, 5, 6, 7].map((n) => card('7', 'H', n)); // canasta
  g.players[0].hand = [card('9', 'H', 1), card('9', 'S', 1), card('9', 'D', 1), card('A', 'C', 1)];
  const r = g.meld([['9-H-1', '9-S-1', '9-D-1']]);
  assert.ok(r.ok, r.error);
  assert.equal(g.players[0].hand.length, 1);
});

test('jaatynyt pino vaatii 2 luonnollista', () => {
  const g = new Game({ players: [{}, {}], rng: seededRng(23) });
  g.turn = 0;
  g.phase = 'draw';
  g.frozen = true;
  g.teamOf(0).hasOpened = true;
  g.discard = [card('K', 'H', 1)];
  g.players[0].hand = [card('K', 'S', 1), card('2', 'H', 1)];
  // 1 luonnollinen + villi ei riita jaatyneessa
  const r = g.takeDiscard(['K-S-1', '2-H-1']);
  assert.equal(r.ok, false);
});
