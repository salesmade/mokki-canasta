// Sarjojen (melds) tarkistus ja canasta-logiikka — Annelin Canasta.
import { isWild, cardValue, isBlackThree } from './cards.js';

// Tarkistaa onko korttijoukko laillinen sarja.
// Palauttaa { valid, rank, clean, wilds, error }.
export function validateMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return { valid: false, error: 'Sarjassa oltava vahintaan 3 korttia' };
  }
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));

  if (wilds.length > 3) {
    return { valid: false, error: 'Sarjassa enintaan 3 apukorttia' };
  }
  if (naturals.length < 2) {
    return { valid: false, error: 'Sarjassa vahintaan 2 luonnollista korttia' };
  }
  const rank = naturals[0].rank;
  if (rank === '3') {
    // Mustan kolmosen sarja: sallittu vain luonnollisilla mustilla kolmosilla (ei villejä).
    // (Moottori sallii sen laskemisen vain ulos mennessa.)
    if (wilds.length > 0) return { valid: false, error: 'Kolmossarjaan ei saa laittaa villejä' };
    if (!naturals.every(isBlackThree)) return { valid: false, error: 'Kolmosia ei lasketa normaalina sarjana' };
    return { valid: true, rank: '3', clean: true, wilds: 0, blackThrees: true };
  }
  if (naturals.some((c) => c.rank !== rank)) {
    return { valid: false, error: 'Kaikkien luonnollisten oltava samaa numeroa' };
  }
  return { valid: true, rank, clean: wilds.length === 0, wilds: wilds.length };
}

// Onko sarja canasta (7+ korttia).
export function isCanasta(cards) {
  return cards.length >= 7;
}

// Onko puhdas canasta (7+ korttia, ei yhtaan villia).
export function isCleanCanasta(cards) {
  return isCanasta(cards) && cards.every((c) => !isWild(c));
}

// Sarjan pistearvo = korttien pisteet + mahdollinen canasta-bonus.
// Puhdas canasta +500, likainen +300 (Annelin saannot).
export function meldScore(cards) {
  let score = cards.reduce((sum, c) => sum + cardValue(c), 0);
  if (isCanasta(cards)) {
    score += isCleanCanasta(cards) ? 500 : 300;
  }
  return score;
}

// Pelkka korttien pistearvo ilman bonuksia (kaytetaan avausrajan laskentaan).
export function cardsPointSum(cards) {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
}
