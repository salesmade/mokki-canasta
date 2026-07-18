import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { botPlayTurn } from '../src/bot.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function countCards(g) {
  let n = g.deck.length + g.discard.length;
  for (const p of g.players) n += p.hand.length;
  for (const t of g.teams) {
    for (const m of Object.values(t.melds)) n += m.length;
    n += t.redThrees;
  }
  return n;
}

// Aja täysi jako pelkillä boteilla ja varmista että se päättyy siististi.
function playFullRound(seed, numPlayers) {
  const players = Array.from({ length: numPlayers }, (_, i) => ({ name: `Botti${i}`, isBot: true }));
  const g = new Game({ players, rng: seededRng(seed) });
  let guard = 0;
  while (!g.roundOver && guard < 2000) {
    assert.equal(countCards(g), 108, `korttimaara sailyy (kierros ${guard})`);
    botPlayTurn(g);
    guard++;
  }
  assert.ok(g.roundOver, 'jaon pitää päättyä');
  assert.ok(guard < 2000, 'ei saa jäädä jumiin');
  return g;
}

test('2 botin jako pelautuu loppuun (useita siemeniä)', () => {
  for (const seed of [1, 2, 3, 42, 99, 123, 777]) {
    const g = playFullRound(seed, 2);
    assert.equal(countCards(g), 108);
  }
});

test('3 botin jako pelautuu loppuun', () => {
  for (const seed of [5, 50, 500]) {
    const g = playFullRound(seed, 3);
    assert.equal(countCards(g), 108);
  }
});

test('4 botin (parit) jako pelautuu loppuun', () => {
  for (const seed of [8, 80, 800]) {
    const g = playFullRound(seed, 4);
    assert.equal(g.teams.length, 2);
    assert.equal(countCards(g), 108);
  }
});

test('jokin joukkue avaa ja tekee sarjoja edes joskus', () => {
  let openedSomewhere = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const g = playFullRound(seed, 3);
    if (g.teams.some((t) => t.hasOpened)) openedSomewhere = true;
  }
  assert.ok(openedSomewhere, 'bottien pitäisi avata ainakin joskus');
});
