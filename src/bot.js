// Kevyt botti — pelaa laillisia, jarkevia siirtoja. Ei taydellinen, riittaa harjoitteluun.
import { isWild, isBlackThree, cardValue, isRedThree } from './cards.js';
import { openingRequirement } from './scoring.js';

// Ryhmittele kasin luonnolliset kortit numeron mukaan (ei villit, ei kolmoset).
function groupByRank(hand) {
  const groups = {};
  for (const c of hand) {
    if (isWild(c) || c.rank === '3') continue;
    (groups[c.rank] ||= []).push(c);
  }
  return groups;
}

function wildsIn(hand) {
  return hand.filter(isWild);
}

// Pelaa botin koko vuoro annetulle pelille (mutatoi peliä).
export function botPlayTurn(game) {
  const actions = [];
  const player = game.current();
  const team = game.teamOf(game.turn);

  // 1) NOSTO: ota pino jos jarkevaa, muuten pakasta.
  const top = game.topDiscard();
  let took = false;
  if (top && !isBlackThree(top) && !isWild(top) && top.rank !== '3') {
    const matches = player.hand.filter((c) => !isWild(c) && c.rank === top.rank);
    if (team.hasOpened && matches.length >= 2) {
      const r = game.takeDiscard([matches[0].id, matches[1].id]);
      if (r.ok) { took = true; actions.push('ota pino'); }
    }
  }
  if (!took) {
    game.drawFromDeck();
    actions.push('nosta pakasta');
    if (game.roundOver) return actions;
  }

  // Kättä ei saa laskea heittokorttia lyhyemmäksi, paitsi jos voi mennä ulos (canasta).
  // minKeep = montako korttia kädessä on säilyttävä laskun jälkeen.
  const minKeep = () => (game.teamHasCanasta(team) ? 1 : 2);

  // 2) AVAUS jos ei viela avattu ja saa kokoon rajan verran.
  if (!team.hasOpened) {
    const groups = groupByRank(player.hand);
    const candidates = Object.entries(groups).filter(([, cs]) => cs.length >= 3);
    let points = 0;
    let total = 0;
    const chosen = [];
    for (const [, cs] of candidates) {
      chosen.push(cs.map((c) => c.id));
      points += cs.reduce((s, c) => s + cardValue(c), 0);
      total += cs.length;
    }
    const need = openingRequirement(team.score);
    if (points >= need && chosen.length && player.hand.length - total >= minKeep()) {
      const r = game.meld(chosen);
      if (r.ok) actions.push('avaus');
    }
  }

  if (team.hasOpened) {
    // 3) Jo avattu: laske uusia sarjoja ja jatka olemassa olevia.
    const groups = groupByRank(player.hand);
    for (const [rank, cs] of Object.entries(groups)) {
      if (team.melds[rank]) {
        // Jatka olemassa olevaa.
        if (cs.length >= 1 && player.hand.length - cs.length >= minKeep()) {
          const r = game.meld([cs.map((c) => c.id)]);
          if (r.ok) actions.push(`jatka ${rank}`);
        }
      } else if (cs.length >= 3 && player.hand.length - cs.length >= minKeep()) {
        const r = game.meld([cs.map((c) => c.id)]);
        if (r.ok) actions.push(`sarja ${rank}`);
      }
    }
  }

  // 4) HEITTO: heitä huonoin yksittäiskortti (ei villi, ei musta 3 mieluiten).
  const cardId = chooseDiscard(game, player, team);
  const r = game.discardCard(cardId);
  if (!r.ok) {
    // Varasiirto: heitä mikä tahansa laillinen kortti.
    for (const c of player.hand) {
      const rr = game.discardCard(c.id);
      if (rr.ok) { actions.push('heitto (vara)'); return actions; }
    }
  }
  actions.push('heitto');
  return actions;
}

// Valitse heitettävä kortti: säilytä villit ja parit, heitä yksinäinen korkea-arvoinen.
function chooseDiscard(game, player, team) {
  const counts = {};
  for (const c of player.hand) counts[c.rank] = (counts[c.rank] || 0) + 1;

  const candidates = player.hand.filter((c) => !isWild(c) && !isRedThree(c));
  // Mieluiten yksinäisiä kortteja joita ei ole omissa sarjoissa.
  const singles = candidates.filter(
    (c) => counts[c.rank] === 1 && !(team.melds[c.rank]));
  const pool = singles.length ? singles : (candidates.length ? candidates : player.hand);
  // Musta kolmonen viimeisenä (estää vastustajaa) mutta ei jos vain se jää.
  const nonBlack = pool.filter((c) => !isBlackThree(c));
  const finalPool = nonBlack.length ? nonBlack : pool;
  // Heitä korkein pistearvo pois kädestä.
  finalPool.sort((a, b) => cardValue(b) - cardValue(a));
  return finalPool[0].id;
}
