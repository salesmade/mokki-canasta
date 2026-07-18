// Avausraja ja jaon lopun pistelasku — Annelin Canasta.
import { cardValue, isWild } from './cards.js';
import { meldScore } from './melds.js';

// Avausraja kertyneen pistemaaran mukaan (Annelin saannot).
export function openingRequirement(teamScore) {
  if (teamScore >= 3000) return 120;
  if (teamScore >= 1500) return 90;
  return 50;
}

export const GO_OUT_BONUS = 100; // "pohjat": lopetusbonus
export const RED_THREE_EACH = 100; // punainen 3 avauksen jalkeen
export const ALL_RED_THREES = 800; // kaikki 4 punaista
export const WIN_SCORE = 5000;

// Punaisten kolmosten bonus. Jos ei avattu -> miinusta. 4 kpl -> 800 (tai -800).
export function redThreeScore(count, hasOpened) {
  if (count <= 0) return 0;
  const value = count >= 4 ? ALL_RED_THREES : count * RED_THREE_EACH;
  return hasOpened ? value : -value;
}

// Laskee yhden joukkueen jaon lopputuloksen.
// team = { melds: [ [cards]... ], redThrees: n, hand: [cards], hasOpened: bool, wentOut: bool }
// Palauttaa erittelyn ja loppusumman.
export function scoreTeamHand(team) {
  const meldPoints = team.melds.reduce((sum, m) => sum + meldScore(m), 0);
  const goOut = team.wentOut ? GO_OUT_BONUS : 0;
  const redThrees = redThreeScore(team.redThrees, team.hasOpened);
  const handPenalty = team.hand.reduce((sum, c) => sum + cardValue(c), 0);

  // Ilman avausta kaikki on miinusta: ei sarjapisteita, kasi pelkkaa miinusta.
  const tablePoints = team.hasOpened ? meldPoints + goOut : 0;
  const total = tablePoints + redThrees - handPenalty;

  return {
    meldPoints,
    goOutBonus: goOut,
    redThrees,
    handPenalty,
    total,
  };
}
