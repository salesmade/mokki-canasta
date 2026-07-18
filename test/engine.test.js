import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, cardValue, isWild, isRedThree, isBlackThree, shuffle } from '../src/cards.js';
import { validateMeld, isCanasta, isCleanCanasta, meldScore, cardsPointSum } from '../src/melds.js';
import { openingRequirement, redThreeScore, scoreTeamHand } from '../src/scoring.js';

// Pieni apuri korttien luomiseen testeissa.
const c = (rank, suit = 'H') => ({ rank, suit, id: `${rank}${suit}${Math.round(cardValue({ rank, suit }))}` });
const joker = () => ({ rank: 'JOKER', suit: null, id: 'j' + Math.round(Math.random() * 1e9) });

test('pakassa on 108 korttia (2 pakkaa + 4 jokeria)', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter((x) => x.rank === 'JOKER').length, 4);
  assert.equal(deck.filter((x) => x.rank === 'A').length, 8);
});

test('korttien pistearvot Annelin mukaan', () => {
  assert.equal(cardValue(c('JOKER')), 50);
  assert.equal(cardValue(c('2')), 20);
  assert.equal(cardValue(c('A')), 20);
  assert.equal(cardValue(c('K')), 10);
  assert.equal(cardValue(c('8')), 10);
  assert.equal(cardValue(c('7')), 5);
  assert.equal(cardValue(c('4')), 5);
  assert.equal(cardValue(c('3')), 5);
});

test('villit, punaiset ja mustat kolmoset tunnistetaan', () => {
  assert.ok(isWild(c('2')));
  assert.ok(isWild(joker()));
  assert.ok(!isWild(c('A')));
  assert.ok(isRedThree(c('3', 'H')));
  assert.ok(isRedThree(c('3', 'D')));
  assert.ok(!isRedThree(c('3', 'S')));
  assert.ok(isBlackThree(c('3', 'S')));
  assert.ok(isBlackThree(c('3', 'C')));
});

test('validi sarja: 3 samaa', () => {
  const r = validateMeld([c('K', 'H'), c('K', 'S'), c('K', 'D')]);
  assert.equal(r.valid, true);
  assert.equal(r.rank, 'K');
  assert.equal(r.clean, true);
});

test('validi sarja: 2 samaa + apukortti (likainen)', () => {
  const r = validateMeld([c('K', 'H'), c('K', 'S'), c('2', 'D')]);
  assert.equal(r.valid, true);
  assert.equal(r.clean, false);
});

test('liian vahan luonnollisia (1 + 2 villia) ei kelpaa', () => {
  const r = validateMeld([c('K', 'H'), c('2', 'S'), joker()]);
  assert.equal(r.valid, false);
});

test('yli 3 villia ei kelpaa', () => {
  const r = validateMeld([c('K', 'H'), c('K', 'S'), c('2', 'D'), c('2', 'S'), joker(), joker()]);
  assert.equal(r.valid, false);
});

test('kolmosia ei lasketa normaalina sarjana', () => {
  const r = validateMeld([c('3', 'S'), c('3', 'C'), c('3', 'S')]);
  assert.equal(r.valid, false);
});

test('canasta: puhdas vs likainen tunnistus + pisteet', () => {
  const puhdas = [c('7'), c('7'), c('7'), c('7'), c('7'), c('7'), c('7')];
  const likainen = [c('7'), c('7'), c('7'), c('7'), c('7'), c('2'), joker()];
  assert.ok(isCanasta(puhdas));
  assert.ok(isCleanCanasta(puhdas));
  assert.ok(isCanasta(likainen));
  assert.ok(!isCleanCanasta(likainen));
  // puhdas: 7*5 + 500 = 535
  assert.equal(meldScore(puhdas), 7 * 5 + 500);
  // likainen: 5*5 + 20 + 50 + 300 = 395
  assert.equal(meldScore(likainen), 5 * 5 + 20 + 50 + 300);
});

test('avausraja nousee pistemaaran mukaan (Anneli 50/90/120)', () => {
  assert.equal(openingRequirement(0), 50);
  assert.equal(openingRequirement(1499), 50);
  assert.equal(openingRequirement(1500), 90);
  assert.equal(openingRequirement(2999), 90);
  assert.equal(openingRequirement(3000), 120);
});

test('avaussumma lasketaan pelkista korttipisteista (ei bonuksia)', () => {
  // 3 kuningasta = 30 p, ei riita 50:een
  assert.equal(cardsPointSum([c('K'), c('K'), c('K')]), 30);
  // 3 assaa = 60 p, riittaa
  assert.equal(cardsPointSum([c('A'), c('A'), c('A')]), 60);
});

test('punaisten kolmosten pisteet: avattu vs ei-avattu', () => {
  assert.equal(redThreeScore(1, true), 100);
  assert.equal(redThreeScore(1, false), -100);
  assert.equal(redThreeScore(4, true), 800);
  assert.equal(redThreeScore(4, false), -800);
  assert.equal(redThreeScore(0, true), 0);
});

test('jaon loppupisteet: avannut joukkue', () => {
  const puhdasCanasta = [c('K'), c('K'), c('K'), c('K'), c('K'), c('K'), c('K')]; // 70 + 500
  const team = {
    melds: [puhdasCanasta],
    redThrees: 1,
    hand: [c('A'), c('5')], // 25 miinusta
    hasOpened: true,
    wentOut: true,
  };
  const r = scoreTeamHand(team);
  // 570 melds + 100 goOut + 100 red3 - 25 kasi = 745
  assert.equal(r.total, 570 + 100 + 100 - 25);
});

test('jaon loppupisteet: ei avannut -> kaikki kadessa miinusta, ei sarjapisteita', () => {
  const team = {
    melds: [[c('K'), c('K'), c('K')]],
    redThrees: 2,
    hand: [c('A'), c('K')], // 30 miinusta
    hasOpened: false,
    wentOut: false,
  };
  const r = scoreTeamHand(team);
  // ei sarjapisteita, punaiset -200, kasi -30 => -230
  assert.equal(r.total, -200 - 30);
});

test('shuffle sailyttaa 108 korttia', () => {
  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const deck = shuffle(buildDeck(), rng);
  assert.equal(deck.length, 108);
});
