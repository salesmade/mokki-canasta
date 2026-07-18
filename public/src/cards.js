// Kortit ja niiden perusominaisuudet — Annelin Canasta.
// Kortti: { rank, suit, id }.  rank: 'A','2'..'10','J','Q','K','JOKER'.  suit: 'H','D','C','S' (jokerilla null).

export const SUITS = ['H', 'D', 'C', 'S'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Villi kortti = 2 tai jokeri ("apukortti").
export function isWild(card) {
  return card.rank === '2' || card.rank === 'JOKER';
}

// Punainen kolmonen = bonuskortti (hertta/ruutu 3).
export function isRedThree(card) {
  return card.rank === '3' && (card.suit === 'H' || card.suit === 'D');
}

// Musta kolmonen = erikoiskortti (risti/pata 3): estokortti, lasketaan vain lopettaessa.
export function isBlackThree(card) {
  return card.rank === '3' && (card.suit === 'C' || card.suit === 'S');
}

// Yksittaisen kortin pistearvo (ei sisalla canasta- eika punainen-3-bonuksia).
export function cardValue(card) {
  if (card.rank === 'JOKER') return 50;
  if (card.rank === '2') return 20;
  if (card.rank === 'A') return 20;
  if (['8', '9', '10', 'J', 'Q', 'K'].includes(card.rank)) return 10;
  // 3,4,5,6,7 = 5
  return 5;
}

// Rakentaa taydellisen pakan: 2 x 52 + 4 jokeria = 108 korttia.
export function buildDeck() {
  const deck = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit, id: id++ });
      }
    }
  }
  for (let j = 0; j < 4; j++) {
    deck.push({ rank: 'JOKER', suit: null, id: id++ });
  }
  return deck;
}

// Sekoittaa pakan paikallaan (Fisher-Yates). rng() palauttaa [0,1).
export function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
