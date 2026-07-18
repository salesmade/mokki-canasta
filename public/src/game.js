// Vuoromoottori — koko pelin kulku Annelin saannoilla.
// Kaikki logiikka taalla; kayttoliittyma ja botti rakentuvat taman paalle.
import { buildDeck, shuffle, isWild, isRedThree, isBlackThree, cardValue } from './cards.js';
import { validateMeld, isCanasta } from './melds.js';
import { openingRequirement, scoreTeamHand } from './scoring.js';

const HAND_SIZES = { 2: 15, 3: 13, 4: 11 };

export class Game {
  // opts: { players: [{name, isBot}], rng, teams }
  constructor(opts = {}) {
    const players = opts.players || [{ name: 'P1' }, { name: 'P2' }];
    const n = players.length;
    if (n < 2 || n > 4) throw new Error('Pelaajia oltava 2-4');
    this.rng = opts.rng || Math.random;

    // Joukkueet: 4 pelaajaa -> parit (0,2)(1,3); muuten jokainen itselleen.
    const teamIdxs = opts.teams || (n === 4 ? [[0, 2], [1, 3]] : players.map((_, i) => [i]));

    this.teams = teamIdxs.map((idxs, id) => ({
      id,
      playerIdxs: idxs,
      melds: {}, // { rank: [cards] }
      redThrees: 0,
      hasOpened: false,
      score: opts.startScores ? opts.startScores[id] : 0,
    }));

    this.players = players.map((p, i) => ({
      id: i,
      name: p.name || `P${i + 1}`,
      isBot: !!p.isBot,
      teamId: this.teams.findIndex((t) => t.playerIdxs.includes(i)),
      hand: [],
    }));

    this.deck = shuffle(buildDeck(), this.rng);
    this.discard = [];
    this.frozen = false;
    this.turn = 0;
    this.phase = 'draw';
    this.roundOver = false;
    this.wentOutPlayer = null;
    this.log = [];

    this._deal(HAND_SIZES[n]);
    this._resolveInitialRedThrees();
    this._flipStartCard();
  }

  // ---- Alustus ----

  _deal(handSize) {
    for (let k = 0; k < handSize; k++) {
      for (const p of this.players) p.hand.push(this.deck.pop());
    }
  }

  // Jaossa saadut punaiset kolmoset pöytään, nostetaan tilalle uudet.
  _resolveInitialRedThrees() {
    for (const p of this.players) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = p.hand.length - 1; i >= 0; i--) {
          if (isRedThree(p.hand[i])) {
            p.hand.splice(i, 1);
            this.teams[p.teamId].redThrees++;
            if (this.deck.length) p.hand.push(this.deck.pop());
            changed = true;
          }
        }
      }
    }
  }

  // Kaannetaan aloituskortti pinoon. Villi tai punainen 3 jaadyttaa pinon.
  _flipStartCard() {
    let card = this.deck.pop();
    // Punaista kolmosta ei jateta pinoon: nostetaan uusi, mutta pino jaatyy.
    while (isRedThree(card)) {
      this.frozen = true;
      card = this.deck.pop();
    }
    this.discard.push(card);
    if (isWild(card)) this.frozen = true;
  }

  // ---- Sarjallistus (serverless: tila Supabaseen ja takaisin) ----
  // rng:a tarvitaan vain jaossa; siirtojen aikana ei, joten fromState ei sekoita.

  serialize() {
    return {
      deck: this.deck, discard: this.discard, frozen: this.frozen, turn: this.turn,
      phase: this.phase, roundOver: this.roundOver, wentOutPlayer: this.wentOutPlayer,
      log: this.log,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, teamId: p.teamId, hand: p.hand,
      })),
      teams: this.teams.map((t) => ({
        id: t.id, playerIdxs: t.playerIdxs, melds: t.melds,
        redThrees: t.redThrees, hasOpened: t.hasOpened, score: t.score,
      })),
    };
  }

  static fromState(s) {
    const g = Object.create(Game.prototype);
    g.rng = Math.random; // ei käytössä siirroissa
    g.deck = s.deck; g.discard = s.discard; g.frozen = s.frozen;
    g.turn = s.turn; g.phase = s.phase; g.roundOver = s.roundOver;
    g.wentOutPlayer = s.wentOutPlayer; g.log = s.log || [];
    g.players = s.players; g.teams = s.teams;
    return g;
  }

  // ---- Apurit ----

  current() { return this.players[this.turn]; }
  teamOf(playerIdx) { return this.teams[this.players[playerIdx].teamId]; }
  topDiscard() { return this.discard[this.discard.length - 1] || null; }

  _next() {
    this.turn = (this.turn + 1) % this.players.length;
    this.phase = 'draw';
  }

  _err(msg) { return { ok: false, error: msg }; }
  _ok(extra = {}) { return { ok: true, ...extra }; }

  // Onko joukkueella vahintaan yksi canasta.
  teamHasCanasta(team) {
    return Object.values(team.melds).some((m) => isCanasta(m));
  }

  // ---- Siirrot ----

  // Nosta pakasta. Punaiset kolmoset menevat suoraan pöytään ja nostetaan uusi.
  drawFromDeck() {
    if (this.phase !== 'draw') return this._err('Ei nostovaihe');
    if (!this.deck.length) return this._endRound('pakka loppui');
    const team = this.teamOf(this.turn);
    let card = this.deck.pop();
    while (isRedThree(card)) {
      team.redThrees++;
      this.log.push(`${this.current().name} nosti punaisen kolmosen`);
      if (!this.deck.length) { this.phase = 'action'; return this._ok({ drewRedThree: true }); }
      card = this.deck.pop();
    }
    this.current().hand.push(card);
    this.phase = 'action';
    return this._ok({ card });
  }

  // Voiko nostaa poistopinon annetuilla kasikorteilla (idt).
  // Palauttaa { ok, error, rank }.
  canTakeDiscard(cardIds) {
    if (this.phase !== 'draw') return this._err('Ei nostovaihe');
    const top = this.topDiscard();
    if (!top) return this._err('Pino tyhja');
    if (isBlackThree(top)) return this._err('Musta kolmonen estaa pinon noston');
    if (isWild(top)) return this._err('Villi kortti pinon paalla, ei voi nostaa');
    if (top.rank === '3') return this._err('Kolmosta ei voi kayttaa sarjaan');

    const hand = this.current().hand;
    const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return this._err('Kortti ei ole kadessa');

    const naturals = cards.filter((c) => !isWild(c) && c.rank === top.rank);
    const wilds = cards.filter(isWild);
    const okUnfrozen = naturals.length >= 2 || (naturals.length >= 1 && wilds.length >= 1);
    const okFrozen = naturals.length >= 2;
    const allowed = this.frozen ? okFrozen : okUnfrozen;
    if (!allowed) {
      return this._err(this.frozen
        ? 'Jaatynyt pino: tarvitset 2 samaa luonnollista korttia'
        : 'Tarvitset 2 samaa, tai 1 sama + apukortti');
    }
    // Sarjan on oltava validi (top + valitut).
    const meld = [top, ...cards];
    const v = validateMeld(meld);
    if (!v.valid) return this._err(v.error);
    return this._ok({ rank: top.rank, meld });
  }

  // Nosta poistopino: top + valitut kortit sarjaksi, loput pinosta kateen.
  takeDiscard(cardIds) {
    const check = this.canTakeDiscard(cardIds);
    if (!check.ok) return check;
    const team = this.teamOf(this.turn);

    // Avausraja: jos ei viela avattu, sarjan korttipisteiden riitettava.
    if (!team.hasOpened) {
      const points = check.meld.reduce((s, c) => s + cardValue(c), 0);
      const need = openingRequirement(team.score);
      if (points < need) {
        return this._err(`Avaukseen tarvitaan ${need} p, sarjassa vain ${points} p`);
      }
      team.hasOpened = true;
    }

    const hand = this.current().hand;
    // Poista valitut kadesta.
    for (const id of cardIds) {
      const idx = hand.findIndex((c) => c.id === id);
      hand.splice(idx, 1);
    }
    // Ota top pois pinosta ja muodosta sarja.
    const top = this.discard.pop();
    const rank = top.rank;
    if (!team.melds[rank]) team.melds[rank] = [];
    team.melds[rank].push(top, ...cardIds.map((id) => check.meld.find((c) => c.id === id)));
    // Loput pinosta kateen.
    while (this.discard.length) hand.push(this.discard.pop());
    this.frozen = false;
    this.phase = 'action';
    this.log.push(`${this.current().name} nosti poistopinon`);
    return this._ok({ rank });
  }

  // Laske sarjoja pöytään. groups = [[cardId,...], ...].
  // Ilman avausta koko kutsu on avausyritys: korttipisteet vähintään avausraja.
  meld(groups) {
    if (this.phase !== 'action') return this._err('Laske vasta noston jalkeen');
    const player = this.current();
    const team = this.teamOf(this.turn);
    const opening = !team.hasOpened;

    // Kerää ja validoi.
    const resolved = [];
    for (const group of groups) {
      const cards = group.map((id) => player.hand.find((c) => c.id === id));
      if (cards.some((c) => !c)) return this._err('Kortti ei ole kadessa');
      // Yhdistys olemassa olevaan sarjaan (jos jo avattu ja sama numero).
      const naturals = cards.filter((c) => !isWild(c));
      const rank = naturals.length ? naturals[0].rank : null;
      const existing = rank && team.melds[rank] ? team.melds[rank] : null;

      if (existing) {
        const combined = [...existing, ...cards];
        const v = validateMeld(combined);
        if (!v.valid) return this._err(v.error);
        resolved.push({ rank, cards, extend: true });
      } else {
        const v = validateMeld(cards);
        if (!v.valid) return this._err(v.error);
        resolved.push({ rank: v.rank, cards, extend: false });
      }
    }

    // Avausrajan tarkistus (vain uusien korttien korttipisteet).
    if (opening) {
      const points = resolved.reduce(
        (s, r) => s + r.cards.reduce((a, c) => a + cardValue(c), 0), 0);
      const need = openingRequirement(team.score);
      if (points < need) {
        return this._err(`Avaukseen tarvitaan ${need} p, sarjoissa vain ${points} p`);
      }
    }

    // Toteuta: poista kadesta, lisää sarjoihin.
    for (const r of resolved) {
      for (const c of r.cards) {
        const idx = player.hand.findIndex((h) => h.id === c.id);
        player.hand.splice(idx, 1);
      }
      if (!team.melds[r.rank]) team.melds[r.rank] = [];
      team.melds[r.rank].push(...r.cards);
    }
    if (opening) team.hasOpened = true;
    return this._ok();
  }

  // Heitä kortti ja päätä vuoro. Jos kasi tyhjenee ja joukkueella on canasta -> ulos.
  discardCard(cardId) {
    if (this.phase !== 'action') return this._err('Nosta ensin');
    const player = this.current();
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return this._err('Kortti ei ole kadessa');

    // Ulos meno: viimeinen kortti heitetaan ja kasi tyhjenee.
    const goingOut = player.hand.length === 1;
    if (goingOut && !this.teamHasCanasta(this.teamOf(this.turn))) {
      return this._err('Et voi mennä ulos ilman canastaa');
    }

    const [card] = player.hand.splice(idx, 1);
    this.discard.push(card);
    if (isWild(card) || isBlackThree(card)) this.frozen = isWild(card) ? true : this.frozen;
    this.log.push(`${player.name} heitti ${card.rank}`);

    if (player.hand.length === 0) {
      this.wentOutPlayer = this.turn;
      return this._endRound('ulos');
    }
    this._next();
    return this._ok({ card });
  }

  // ---- Jaon loppu ----

  _endRound(reason) {
    this.roundOver = true;
    this.phase = 'ended';
    const results = this.teams.map((team) => {
      const melds = Object.values(team.melds);
      const hand = team.playerIdxs.flatMap((i) => this.players[i].hand);
      const wentOut = this.wentOutPlayer !== null
        && this.players[this.wentOutPlayer].teamId === team.id;
      const r = scoreTeamHand({
        melds,
        redThrees: team.redThrees,
        hand,
        hasOpened: team.hasOpened,
        wentOut,
      });
      team.score += r.total;
      return { teamId: team.id, ...r, newScore: team.score };
    });
    return this._ok({ roundOver: true, reason, results });
  }
}
