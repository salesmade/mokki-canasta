// src/cards.js
var SUITS = ["H", "D", "C", "S"];
var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function isWild(card) {
  return card.rank === "2" || card.rank === "JOKER";
}
function isRedThree(card) {
  return card.rank === "3" && (card.suit === "H" || card.suit === "D");
}
function isBlackThree(card) {
  return card.rank === "3" && (card.suit === "C" || card.suit === "S");
}
function cardValue(card) {
  if (card.rank === "JOKER") return 50;
  if (card.rank === "2") return 20;
  if (card.rank === "A") return 20;
  if (["8", "9", "10", "J", "Q", "K"].includes(card.rank)) return 10;
  return 5;
}
function buildDeck() {
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
    deck.push({ rank: "JOKER", suit: null, id: id++ });
  }
  return deck;
}
function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// src/melds.js
function validateMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return { valid: false, error: "Sarjassa oltava vahintaan 3 korttia" };
  }
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (wilds.length > 3) {
    return { valid: false, error: "Sarjassa enintaan 3 apukorttia" };
  }
  if (naturals.length < 2) {
    return { valid: false, error: "Sarjassa vahintaan 2 luonnollista korttia" };
  }
  const rank = naturals[0].rank;
  if (rank === "3") {
    if (wilds.length > 0) return { valid: false, error: "Kolmossarjaan ei saa laittaa villej\xE4" };
    if (!naturals.every(isBlackThree)) return { valid: false, error: "Kolmosia ei lasketa normaalina sarjana" };
    return { valid: true, rank: "3", clean: true, wilds: 0, blackThrees: true };
  }
  if (naturals.some((c) => c.rank !== rank)) {
    return { valid: false, error: "Kaikkien luonnollisten oltava samaa numeroa" };
  }
  return { valid: true, rank, clean: wilds.length === 0, wilds: wilds.length };
}
function isCanasta(cards) {
  return cards.length >= 7;
}
function isCleanCanasta(cards) {
  return isCanasta(cards) && cards.every((c) => !isWild(c));
}
function meldScore(cards) {
  let score = cards.reduce((sum, c) => sum + cardValue(c), 0);
  if (isCanasta(cards)) {
    score += isCleanCanasta(cards) ? 500 : 300;
  }
  return score;
}

// src/scoring.js
function openingRequirement(teamScore) {
  if (teamScore >= 3e3) return 120;
  if (teamScore >= 1500) return 90;
  if (teamScore < 0) return 15;
  return 50;
}
var GO_OUT_BONUS = 100;
var CONCEALED_GO_OUT_BONUS = 200;
var RED_THREE_EACH = 100;
var ALL_RED_THREES = 800;
function redThreeScore(count, hasOpened) {
  if (count <= 0) return 0;
  const value = count >= 4 ? ALL_RED_THREES : count * RED_THREE_EACH;
  return hasOpened ? value : -value;
}
function scoreTeamHand(team) {
  const meldPoints = team.melds.reduce((sum, m) => sum + meldScore(m), 0);
  const goOut = team.wentOut ? team.wentOutConcealed ? CONCEALED_GO_OUT_BONUS : GO_OUT_BONUS : 0;
  const redThrees = redThreeScore(team.redThrees, team.hasOpened);
  const handPenalty = team.hand.reduce((sum, c) => sum + cardValue(c), 0);
  const tablePoints = team.hasOpened ? meldPoints + goOut : 0;
  const total = tablePoints + redThrees - handPenalty;
  return {
    meldPoints,
    goOutBonus: goOut,
    redThrees,
    handPenalty,
    total
  };
}

// src/game.js
var HAND_SIZES = { 2: 15, 3: 13, 4: 11 };
var Game = class _Game {
  // opts: { players: [{name, isBot}], rng, teams }
  constructor(opts = {}) {
    const players = opts.players || [{ name: "P1" }, { name: "P2" }];
    const n = players.length;
    if (n < 2 || n > 4) throw new Error("Pelaajia oltava 2-4");
    this.rng = opts.rng || Math.random;
    const teamIdxs = opts.teams || (n === 4 ? [[0, 2], [1, 3]] : players.map((_, i) => [i]));
    this.teams = teamIdxs.map((idxs, id) => ({
      id,
      playerIdxs: idxs,
      melds: {},
      // { rank: [cards] }
      redThrees: 0,
      hasOpened: false,
      score: opts.startScores ? opts.startScores[id] : 0
    }));
    this.players = players.map((p, i) => ({
      id: i,
      name: p.name || `P${i + 1}`,
      isBot: !!p.isBot,
      teamId: this.teams.findIndex((t) => t.playerIdxs.includes(i)),
      hand: []
    }));
    this.deck = shuffle(buildDeck(), this.rng);
    this.discard = [];
    this.frozen = false;
    this.turn = 0;
    this.phase = "draw";
    this.roundOver = false;
    this.wentOutPlayer = null;
    this.log = [];
    this._deal(HAND_SIZES[n]);
    this._resolveInitialRedThrees();
    this._flipStartCard();
    this.turnOpenedStart = this.teamOf(this.turn).hasOpened;
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
      deck: this.deck,
      discard: this.discard,
      frozen: this.frozen,
      turn: this.turn,
      phase: this.phase,
      roundOver: this.roundOver,
      wentOutPlayer: this.wentOutPlayer,
      turnOpenedStart: this.turnOpenedStart,
      log: this.log,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        teamId: p.teamId,
        hand: p.hand
      })),
      teams: this.teams.map((t) => ({
        id: t.id,
        playerIdxs: t.playerIdxs,
        melds: t.melds,
        redThrees: t.redThrees,
        hasOpened: t.hasOpened,
        score: t.score
      }))
    };
  }
  static fromState(s) {
    const g = Object.create(_Game.prototype);
    g.rng = Math.random;
    g.deck = s.deck;
    g.discard = s.discard;
    g.frozen = s.frozen;
    g.turn = s.turn;
    g.phase = s.phase;
    g.roundOver = s.roundOver;
    g.wentOutPlayer = s.wentOutPlayer;
    g.log = s.log || [];
    g.players = s.players;
    g.teams = s.teams;
    g.turnOpenedStart = s.turnOpenedStart ?? g.teamOf(g.turn).hasOpened;
    return g;
  }
  // ---- Apurit ----
  current() {
    return this.players[this.turn];
  }
  teamOf(playerIdx) {
    return this.teams[this.players[playerIdx].teamId];
  }
  topDiscard() {
    return this.discard[this.discard.length - 1] || null;
  }
  _next() {
    this.turn = (this.turn + 1) % this.players.length;
    this.phase = "draw";
    this.turnOpenedStart = this.teamOf(this.turn).hasOpened;
  }
  _err(msg) {
    return { ok: false, error: msg };
  }
  _ok(extra = {}) {
    return { ok: true, ...extra };
  }
  // Onko joukkueella vahintaan yksi canasta.
  teamHasCanasta(team) {
    return Object.values(team.melds).some((m) => isCanasta(m));
  }
  // ---- Siirrot ----
  // Nosta pakasta. Punaiset kolmoset menevat suoraan pöytään ja nostetaan uusi.
  drawFromDeck() {
    if (this.phase !== "draw") return this._err("Ei nostovaihe");
    if (!this.deck.length) return this._endRound("pakka loppui");
    const team = this.teamOf(this.turn);
    let card = this.deck.pop();
    while (isRedThree(card)) {
      team.redThrees++;
      this.log.push(`${this.current().name} nosti punaisen kolmosen`);
      if (!this.deck.length) {
        this.phase = "action";
        return this._ok({ drewRedThree: true });
      }
      card = this.deck.pop();
    }
    this.current().hand.push(card);
    this.phase = "action";
    return this._ok({ card });
  }
  // Voiko nostaa poistopinon annetuilla kasikorteilla (idt).
  // Palauttaa { ok, error, rank }.
  canTakeDiscard(cardIds) {
    if (this.phase !== "draw") return this._err("Ei nostovaihe");
    const top = this.topDiscard();
    if (!top) return this._err("Pino tyhja");
    if (isBlackThree(top)) return this._err("Musta kolmonen estaa pinon noston");
    if (isWild(top)) return this._err("Villi kortti pinon paalla, ei voi nostaa");
    if (top.rank === "3") return this._err("Kolmosta ei voi kayttaa sarjaan");
    const hand = this.current().hand;
    const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return this._err("Kortti ei ole kadessa");
    const naturals = cards.filter((c) => !isWild(c) && c.rank === top.rank);
    const wilds = cards.filter(isWild);
    const okUnfrozen = naturals.length >= 2 || naturals.length >= 1 && wilds.length >= 1;
    const okFrozen = naturals.length >= 2;
    const allowed = this.frozen ? okFrozen : okUnfrozen;
    if (!allowed) {
      return this._err(this.frozen ? "Jaatynyt pino: tarvitset 2 samaa luonnollista korttia" : "Tarvitset 2 samaa, tai 1 sama + apukortti");
    }
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
    if (!team.hasOpened) {
      const points = check.meld.reduce((s, c) => s + cardValue(c), 0);
      const need = openingRequirement(team.score);
      if (points < need) {
        return this._err(`Avaukseen tarvitaan ${need} p, sarjassa vain ${points} p`);
      }
      team.hasOpened = true;
    }
    const hand = this.current().hand;
    for (const id of cardIds) {
      const idx = hand.findIndex((c) => c.id === id);
      hand.splice(idx, 1);
    }
    const top = this.discard.pop();
    const rank = top.rank;
    if (!team.melds[rank]) team.melds[rank] = [];
    team.melds[rank].push(top, ...cardIds.map((id) => check.meld.find((c) => c.id === id)));
    while (this.discard.length) hand.push(this.discard.pop());
    this.frozen = false;
    this.phase = "action";
    this.log.push(`${this.current().name} nosti poistopinon`);
    return this._ok({ rank });
  }
  // Laske sarjoja pöytään. groups = [[cardId,...], ...].
  // Ilman avausta koko kutsu on avausyritys: korttipisteet vähintään avausraja.
  meld(groups) {
    if (this.phase !== "action") return this._err("Laske vasta noston jalkeen");
    const player = this.current();
    const team = this.teamOf(this.turn);
    const opening = !team.hasOpened;
    const resolved = [];
    for (const group of groups) {
      const cards = group.map((id) => player.hand.find((c) => c.id === id));
      if (cards.some((c) => !c)) return this._err("Kortti ei ole kadessa");
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
    if (opening) {
      const points = resolved.reduce(
        (s, r) => s + r.cards.reduce((a, c) => a + cardValue(c), 0),
        0
      );
      const need = openingRequirement(team.score);
      if (points < need) {
        return this._err(`Avaukseen tarvitaan ${need} p, sarjoissa vain ${points} p`);
      }
    }
    const totalMelded = resolved.reduce((s, r) => s + r.cards.length, 0);
    const remaining = player.hand.length - totalMelded;
    let willHaveCanasta = this.teamHasCanasta(team);
    for (const r of resolved) {
      const existingLen = team.melds[r.rank] ? team.melds[r.rank].length : 0;
      if (existingLen + r.cards.length >= 7) willHaveCanasta = true;
    }
    if (remaining === 0) {
      return this._err("J\xE4t\xE4 v\xE4hint\xE4\xE4n yksi kortti heittoa varten");
    }
    if (remaining < 2 && !willHaveCanasta) {
      return this._err("Pid\xE4 v\xE4hint\xE4\xE4n 2 korttia \u2014 et voi menn\xE4 ulos ilman canastaa");
    }
    const hasBlackThreeMeld = resolved.some((r) => r.rank === "3");
    if (hasBlackThreeMeld && !(willHaveCanasta && remaining <= 1)) {
      return this._err("Mustat kolmoset saa laskea vain lopettaessa (canasta p\xF6yd\xE4ss\xE4)");
    }
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
    if (this.phase !== "action") return this._err("Nosta ensin");
    const player = this.current();
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return this._err("Kortti ei ole kadessa");
    const goingOut = player.hand.length === 1;
    if (goingOut && !this.teamHasCanasta(this.teamOf(this.turn))) {
      return this._err("Et voi menn\xE4 ulos ilman canastaa");
    }
    const [card] = player.hand.splice(idx, 1);
    this.discard.push(card);
    if (isWild(card) || isBlackThree(card)) this.frozen = isWild(card) ? true : this.frozen;
    this.log.push(`${player.name} heitti ${card.rank}`);
    if (player.hand.length === 0) {
      this.wentOutPlayer = this.turn;
      this.teamOf(this.turn).wentOutConcealed = !this.turnOpenedStart;
      return this._endRound("ulos");
    }
    this._next();
    return this._ok({ card });
  }
  // ---- Jaon loppu ----
  _endRound(reason) {
    this.roundOver = true;
    this.phase = "ended";
    const results = this.teams.map((team) => {
      const melds = Object.values(team.melds);
      const hand = team.playerIdxs.flatMap((i) => this.players[i].hand);
      const wentOut = this.wentOutPlayer !== null && this.players[this.wentOutPlayer].teamId === team.id;
      const r = scoreTeamHand({
        melds,
        redThrees: team.redThrees,
        hand,
        hasOpened: team.hasOpened,
        wentOut,
        wentOutConcealed: wentOut && team.wentOutConcealed
      });
      team.score += r.total;
      return { teamId: team.id, ...r, newScore: team.score };
    });
    return this._ok({ roundOver: true, reason, results });
  }
};

// src/bot.js
function groupByRank(hand) {
  var _a;
  const groups = {};
  for (const c of hand) {
    if (isWild(c) || c.rank === "3") continue;
    (groups[_a = c.rank] || (groups[_a] = [])).push(c);
  }
  return groups;
}
function botPlayTurn(game2) {
  const actions = [];
  const player = game2.current();
  const team = game2.teamOf(game2.turn);
  const top = game2.topDiscard();
  let took = false;
  if (top && !isBlackThree(top) && !isWild(top) && top.rank !== "3") {
    const matches = player.hand.filter((c) => !isWild(c) && c.rank === top.rank);
    if (team.hasOpened && matches.length >= 2) {
      const r2 = game2.takeDiscard([matches[0].id, matches[1].id]);
      if (r2.ok) {
        took = true;
        actions.push("ota pino");
      }
    }
  }
  if (!took) {
    game2.drawFromDeck();
    actions.push("nosta pakasta");
    if (game2.roundOver) return actions;
  }
  const minKeep = () => game2.teamHasCanasta(team) ? 1 : 2;
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
      const r2 = game2.meld(chosen);
      if (r2.ok) actions.push("avaus");
    }
  }
  if (team.hasOpened) {
    const groups = groupByRank(player.hand);
    for (const [rank, cs] of Object.entries(groups)) {
      if (team.melds[rank]) {
        if (cs.length >= 1 && player.hand.length - cs.length >= minKeep()) {
          const r2 = game2.meld([cs.map((c) => c.id)]);
          if (r2.ok) actions.push(`jatka ${rank}`);
        }
      } else if (cs.length >= 3 && player.hand.length - cs.length >= minKeep()) {
        const r2 = game2.meld([cs.map((c) => c.id)]);
        if (r2.ok) actions.push(`sarja ${rank}`);
      }
    }
  }
  const cardId = chooseDiscard(game2, player, team);
  const r = game2.discardCard(cardId);
  if (!r.ok) {
    for (const c of player.hand) {
      const rr = game2.discardCard(c.id);
      if (rr.ok) {
        actions.push("heitto (vara)");
        return actions;
      }
    }
  }
  actions.push("heitto");
  return actions;
}
function chooseDiscard(game2, player, team) {
  const counts = {};
  for (const c of player.hand) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const candidates = player.hand.filter((c) => !isWild(c) && !isRedThree(c));
  const singles = candidates.filter(
    (c) => counts[c.rank] === 1 && !team.melds[c.rank]
  );
  const pool = singles.length ? singles : candidates.length ? candidates : player.hand;
  const nonBlack = pool.filter((c) => !isBlackThree(c));
  const finalPool = nonBlack.length ? nonBlack : pool;
  finalPool.sort((a, b) => cardValue(b) - cardValue(a));
  return finalPool[0].id;
}

// node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = (function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    })(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode2) {
    mode2 = mode2 || "Byte";
    let newData = null;
    switch (mode2) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode2;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "\u2588\u2588": "\u2588",
      "\u2588 ": "\u2580",
      " \u2588": "\u2584",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "\u2588\u2588": "\u2580",
      "\u2588 ": "\u2580",
      " \u2588": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "\u2588";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "\u2588";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("\u2588\u2588");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = (function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode2, type) {
    if (1 <= type && type < 10) {
      switch (mode2) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode2;
      }
    } else if (type < 27) {
      switch (mode2) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode2;
      }
    } else if (type < 41) {
      switch (mode2) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode2;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
})();
var QRMath = (function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
})();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = (function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  })();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = (function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
})();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !(function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  })("\u53CB", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// web/app.js
var $ = (id) => document.getElementById(id);
var SESSION_KEY = "mokkiCanasta.session";
function saveSession(code, seat) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, seat }));
  } catch {
  }
}
function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var SUIT = { H: "\u2665", D: "\u2666", C: "\u2663", S: "\u2660" };
var RED = (c) => c.suit === "H" || c.suit === "D";
var esc = (s) => String(s).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[ch]);
var cfg = { mode: "local", players: 3, hints: 1, big: 0 };
var mode = "local";
var game = null;
var net = null;
var V = null;
var selected = /* @__PURE__ */ new Set();
var staged = [];
var hintsOn = true;
var peekBots = false;
var busy = false;
var lastDrawnId = null;
var scrolledForId = null;
function bindOpts(containerId, attr, key, after) {
  $(containerId).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    [...$(containerId).children].forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
    cfg[key] = isNaN(Number(b.dataset[attr])) ? b.dataset[attr] : Number(b.dataset[attr]);
    if (after) after();
  });
}
function selectMode(m) {
  cfg.mode = m;
  [...$("modeOpt").children].forEach((b) => b.classList.toggle("sel", b.dataset.m === m));
  const online = m === "online";
  $("onlineJoin").style.display = online ? "" : "none";
  $("startBtn").textContent = online ? "Luo huone" : "Aloita peli";
}
bindOpts("modeOpt", "m", "mode", () => selectMode(cfg.mode));
bindOpts("playerCount", "n", "players");
bindOpts("hintOpt", "h", "hints");
bindOpts("bigOpt", "b", "big");
$("startBtn").onclick = () => {
  hintsOn = !!cfg.hints;
  document.body.classList.toggle("big", !!cfg.big);
  if (cfg.mode === "online") createRoom();
  else startLocal();
};
$("joinBtn").onclick = () => {
  hintsOn = !!cfg.hints;
  document.body.classList.toggle("big", !!cfg.big);
  joinRoom();
};
$("hintChk").onchange = (e) => {
  hintsOn = e.target.checked;
  render();
};
$("peekChk").onchange = (e) => {
  peekBots = e.target.checked;
  render();
};
$("lobbyStart").onclick = async () => {
  await api("/api/start", { code: net.code });
  pollOnce();
};
function newDeal() {
  if (mode === "online") {
    api("/api/next", { code: net.code }).then(pollOnce);
    $("over").style.display = "none";
    return;
  }
  const scores = game.teams.map((t) => t.score);
  const players = game.players.map((p) => ({ name: p.name, isBot: p.isBot }));
  game = new Game({ players, startScores: scores });
  selected = /* @__PURE__ */ new Set();
  staged = [];
  $("over").style.display = "none";
  render();
  maybeRunBots();
}
$("againBtn").onclick = newDeal;
function myName() {
  return $("playerName") && $("playerName").value || "Sin\xE4";
}
function startLocal() {
  mode = "local";
  clearSession();
  const names = [myName(), "Botti 1", "Botti 2", "Botti 3"];
  const players = [];
  for (let i = 0; i < cfg.players; i++) players.push({ name: names[i], isBot: i !== 0 });
  game = new Game({ players });
  selected = /* @__PURE__ */ new Set();
  staged = [];
  $("setup").style.display = "none";
  $("game").style.display = "flex";
  $("hintChk").checked = hintsOn;
  render();
  maybeRunBots();
}
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json().catch(() => ({ error: "Verkkovirhe" }));
}
async function createRoom() {
  const r = await api("/api/create", { name: myName(), seats: cfg.players });
  if (r.error) return alert(r.error);
  openNet(r.code, r.seat);
}
async function joinRoom() {
  const code = ($("joinCode").value || "").toUpperCase();
  if (code.length !== 4) return alert("Anna 4-merkkinen koodi");
  const r = await api("/api/join", { code, name: myName() });
  if (r.error) return alert(r.error);
  openNet(r.code, r.seat);
}
function openNet(code, seat) {
  mode = "online";
  net = { code, seat, lastVersion: 0 };
  selected = /* @__PURE__ */ new Set();
  staged = [];
  saveSession(code, seat);
  $("setup").style.display = "none";
  $("resume") && ($("resume").style.display = "none");
  $("hintChk").checked = hintsOn;
  pollOnce();
  net.timer = setInterval(pollOnce, 1500);
}
function leaveToSetup(msg) {
  if (net && net.timer) clearInterval(net.timer);
  net = null;
  mode = "local";
  clearSession();
  $("game").style.display = "none";
  $("lobby").style.display = "none";
  $("over").style.display = "none";
  $("setup").style.display = "";
  if (msg) alert(msg);
}
async function pollOnce() {
  if (!net) return;
  try {
    const res = await fetch(`/api/state?code=${net.code}&seat=${net.seat}`);
    const snap = await res.json();
    if (snap.error) {
      if (/löydy/i.test(snap.error)) leaveToSetup("Huone ei ole en\xE4\xE4 voimassa. Aloita uusi peli.");
      return;
    }
    handleSnapshot(snap);
  } catch {
  }
}
function handleSnapshot(snap) {
  if (!snap || snap.error) return;
  if (typeof snap.version === "number") {
    if (snap.version <= net.lastVersion) return;
    net.lastVersion = snap.version;
  }
  if (snap.type === "lobby") {
    $("game").style.display = "none";
    $("over").style.display = "none";
    renderLobby(snap);
    return;
  }
  $("lobby").style.display = "none";
  $("game").style.display = "flex";
  V = normalizeView(snap);
  paint();
  if (V.roundOver) showOver();
  else $("over").style.display = "none";
}
function renderLobby(snap) {
  $("lobby").style.display = "block";
  $("lobbyCode").textContent = snap.code;
  if ($("lobbyQR") && typeof location !== "undefined") {
    const url = `${location.origin}/?join=${snap.code}`;
    const qr = qrcode_default(0, "M");
    qr.addData(url);
    qr.make();
    $("lobbyQR").innerHTML = qr.createImgTag(5, 10);
  }
  const list = snap.seats.map((s, i) => `<div>${i + 1}. ${esc(s.name)}${i === snap.you ? " (sin\xE4)" : ""}</div>`).join("");
  const empty = snap.seatCount - snap.seats.length;
  $("lobbyPlayers").innerHTML = list + (empty > 0 ? `<div style="opacity:.6">+ ${empty} paikkaa (t\xE4ytet\xE4\xE4n boteilla)</div>` : "");
  const isHost = snap.you === 0;
  $("lobbyStart").style.display = isHost ? "" : "none";
  $("lobbyHint").textContent = isHost ? "Kun kaikki ovat liittyneet, paina Aloita peli." : "Odota ett\xE4 huoneen luoja aloittaa pelin\u2026";
}
function normalizeLocal() {
  const seat = 0;
  return {
    seat,
    phase: game.phase,
    turn: game.turn,
    frozen: game.frozen,
    roundOver: game.roundOver,
    deckCount: game.deck.length,
    discardTop: game.topDiscard(),
    discardCount: game.discard.length,
    players: game.players.map((p, i) => ({
      seat: i,
      name: p.name,
      isBot: p.isBot,
      teamId: p.teamId,
      handCount: p.hand.length,
      hand: i === seat || p.isBot ? p.hand : null
    })),
    teams: game.teams.map((t) => ({
      id: t.id,
      playerIdxs: t.playerIdxs,
      redThrees: t.redThrees,
      hasOpened: t.hasOpened,
      score: t.score,
      melds: Object.entries(t.melds).map(([rank, cards]) => ({ rank, cards, canasta: isCanasta(cards) }))
    }))
  };
}
function normalizeView(snap) {
  return {
    seat: snap.seat,
    phase: snap.phase,
    turn: snap.turn,
    frozen: snap.frozen,
    roundOver: snap.roundOver,
    deckCount: snap.deckCount,
    discardTop: snap.discardTop,
    discardCount: snap.discardCount,
    players: snap.players,
    teams: snap.teams.map((t) => ({
      ...t,
      melds: Object.entries(t.melds).map(([rank, m]) => ({ rank, cards: m.cards, canasta: m.canasta }))
    }))
  };
}
function myTeam() {
  return V.teams.find((t) => t.playerIdxs.includes(V.seat));
}
function myHand() {
  return V.players.find((p) => p.seat === V.seat).hand || [];
}
function findInHand(id) {
  return myHand().find((c) => c.id === id);
}
function cardEl(card, { small = false, faceDown = false } = {}) {
  const d = document.createElement("div");
  d.className = "card" + (small ? " small" : "");
  if (faceDown) {
    d.classList.add("back");
    return d;
  }
  if (card.rank === "JOKER") {
    d.classList.add("joker");
    d.innerHTML = `<div class="r">\u2605</div><div class="s">JOKER</div>`;
    return d;
  }
  if (RED(card)) d.classList.add("red");
  d.innerHTML = `<div class="r">${card.rank}</div><div class="s">${SUIT[card.suit]}</div>`;
  return d;
}
function canastaChip(m) {
  const clean = m.cards.every((c) => !isWild(c));
  const d = document.createElement("div");
  d.className = "canasta-chip " + (clean ? "clean" : "dirty");
  d.innerHTML = `<div class="cr">${m.rank}</div><div class="cl">canasta</div><div class="cp">${clean ? "500" : "300"}</div><div class="cn">\xD7${m.cards.length}</div>`;
  return d;
}
function render() {
  if (mode === "local") {
    V = normalizeLocal();
  }
  if (!V) return;
  paint();
}
function hintRanks() {
  const counts = {};
  for (const c of myHand()) if (!isWild(c) && c.rank !== "3") counts[c.rank] = (counts[c.rank] || 0) + 1;
  const team = myTeam();
  const set = /* @__PURE__ */ new Set();
  for (const [r, n] of Object.entries(counts)) if (n >= 3) set.add(r);
  for (const m of team.melds) if (counts[m.rank]) set.add(m.rank);
  return set;
}
function paint() {
  const myTurn = V.turn === V.seat && !V.roundOver;
  const dtop = V.discardTop;
  const pileTakeable = myTurn && V.phase === "draw" && dtop && !isWild(dtop) && dtop.rank !== "3";
  $("scores").textContent = V.teams.map((t) => `${t.playerIdxs.map((i) => V.players[i].name).join("+")}: ${t.score}`).join("   |   ");
  const cur = V.players[V.turn];
  $("turnInfo").textContent = V.roundOver ? "Jako p\xE4\xE4ttyi" : myTurn ? "\u27A1\uFE0F Sinun vuorosi" : `Vuorossa: ${esc(cur.name)}`;
  const opp = $("opponents");
  opp.innerHTML = "";
  V.players.forEach((p) => {
    if (p.seat === V.seat) return;
    const team2 = V.teams.find((t) => t.id === p.teamId);
    const melds = team2.melds.map((m) => `${m.rank}\xD7${m.cards.length}${m.canasta ? "\u2B50" : ""}`).join(" ");
    const el = document.createElement("div");
    el.className = "opp" + (V.turn === p.seat ? " active" : "");
    el.innerHTML = `<div class="name">${esc(p.name)}${p.isBot ? " \u{1F916}" : ""}</div>
      <div class="cnt">${p.handCount} korttia${team2.hasOpened ? " \xB7 avannut" : ""}</div>
      <div class="melds">${melds || "\u2014"}</div>`;
    if (peekBots && p.isBot && Array.isArray(p.hand)) {
      const ord = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2", "JOKER"];
      const line = document.createElement("div");
      line.style.cssText = "font-size:.9rem;margin-top:5px;line-height:1.6;font-weight:700";
      line.innerHTML = [...p.hand].sort((a, b) => ord.indexOf(a.rank) - ord.indexOf(b.rank)).map((c) => {
        const red = c.suit === "H" || c.suit === "D";
        const label = c.rank === "JOKER" ? "\u2605J" : c.rank + (SUIT[c.suit] || "");
        return `<span style="color:${red ? "#ff9a8a" : "#e8e8e8"};margin-right:7px;white-space:nowrap">${label}</span>`;
      }).join("");
      el.appendChild(line);
    }
    opp.appendChild(el);
  });
  $("deckCount").textContent = V.deckCount;
  $("deck").innerHTML = "";
  $("deck").appendChild(cardEl(null, { faceDown: true }));
  $("discard").innerHTML = "";
  if (V.discardTop) {
    const dc = cardEl(V.discardTop);
    if (pileTakeable) dc.classList.add("canfetch");
    $("discard").appendChild(dc);
  }
  $("discard").onclick = pileTakeable ? onDiscardClick : null;
  $("discard").style.cursor = pileTakeable ? "pointer" : "default";
  $("discardCap").textContent = "Poistopino" + (V.frozen ? " \u{1F9CA} (j\xE4\xE4tynyt)" : "") + (pileTakeable ? " \xB7 napauta ottaaksesi" : "");
  const mm = $("myMelds");
  mm.innerHTML = "";
  const team = myTeam();
  if (!team.melds.length) mm.innerHTML = '<span style="opacity:.6">Ei viel\xE4 sarjoja</span>';
  for (const m of team.melds) {
    const g = document.createElement("div");
    g.className = "meldgroup";
    if (m.canasta) {
      g.appendChild(canastaChip(m));
    } else {
      g.innerHTML = `<span class="lbl">${m.rank}</span>`;
      m.cards.forEach((c) => g.appendChild(cardEl(c, { small: true })));
    }
    mm.appendChild(g);
  }
  const hints = hintsOn ? hintRanks() : /* @__PURE__ */ new Set();
  const canFetchRank = pileTakeable ? dtop.rank : null;
  const naturalsMatch = pileTakeable ? myHand().filter((c) => !isWild(c) && c.rank === dtop.rank).length : 0;
  const highlightWilds = pileTakeable && !V.frozen && naturalsMatch >= 1;
  const stagedIds = new Set(staged.flat());
  const hand = $("hand");
  hand.innerHTML = "";
  const order = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2", "JOKER"];
  const sorted = [...myHand()].sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
  for (const c of sorted) {
    const el = cardEl(c);
    if (stagedIds.has(c.id)) {
      el.style.opacity = ".25";
    } else {
      if (selected.has(c.id)) el.classList.add("sel");
      if (hints.has(c.rank) && !isWild(c)) el.classList.add("hint");
      if (canFetchRank && !isWild(c) && c.rank === canFetchRank) el.classList.add("canfetch");
      if (highlightWilds && isWild(c)) el.classList.add("canfetch");
      if (c.id === lastDrawnId) {
        el.classList.add("justdrew");
        if (lastDrawnId !== scrolledForId && el.scrollIntoView) {
          scrolledForId = lastDrawnId;
          setTimeout(() => el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }), 40);
        }
      }
      el.onclick = () => {
        if (selected.has(c.id)) selected.delete(c.id);
        else selected.add(c.id);
        render();
      };
    }
    hand.appendChild(el);
  }
  renderActions(myTurn);
  renderMessage(myTurn, hints);
}
function renderActions(myTurn) {
  const a = $("actions");
  a.innerHTML = "";
  if (!myTurn) return;
  const mk = (label, primary, disabled, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (primary) b.className = "primary";
    b.disabled = !!disabled;
    if (!disabled) b.onclick = fn;
    a.appendChild(b);
  };
  if (V.phase === "draw") {
    mk("Nosta pakasta", true, false, doDraw);
    const canTake = mode === "local" ? game.canTakeDiscard([...selected]).ok : selected.size >= 1 && V.discardTop;
    mk("Ota poistopino", false, !canTake, doTakePile);
  } else if (V.phase === "action") {
    const canGoOut = myTeam().melds.some((m) => m.canasta);
    const stuck = myHand().length === 0 || myHand().length === 1 && !canGoOut;
    if (stuck) {
      flash("J\xE4it umpikujaan (ei korttia heittoon ilman ulos menoa). Aloita uusi jako.", "warn");
      mk("\u{1F504} Uusi jako", true, false, newDeal);
      return;
    }
    mk("Lis\xE4\xE4 ryhm\xE4", false, selected.size < 1, stageGroup);
    mk("Laske p\xF6yt\xE4\xE4n", false, staged.length === 0, commitMelds);
    if (staged.length) mk("Peru laskut", false, false, () => {
      staged = [];
      render();
    });
    mk("Heit\xE4 valittu", true, selected.size !== 1, doDiscard);
  }
}
function renderMessage(myTurn, hints) {
  const m = $("msg");
  m.className = "";
  if (V.roundOver) {
    m.textContent = "Jako p\xE4\xE4ttyi.";
    $("pending").textContent = "";
    return;
  }
  if (!myTurn) {
    m.textContent = "";
    $("pending").textContent = "";
    return;
  }
  const team = myTeam();
  if (V.phase === "draw") {
    const top = V.discardTop;
    if (top && !isWild(top) && top.rank !== "3") {
      if (V.frozen) {
        m.textContent = `Nosta pakasta \u2014 tai napauta j\xE4\xE4tynytt\xE4 pinoa (tarvitset 2 luonnollista ${top.rank}:ta, siniset kortit).`;
      } else {
        m.textContent = `Nosta pakasta \u2014 tai napauta poistopinoa ottaaksesi sen (2\xD7 ${top.rank}, tai 1 ${top.rank} + villi; siniset kortit).`;
      }
    } else {
      m.textContent = "Nosta pakasta. (Poistopinoa ei voi ottaa: p\xE4\xE4ll\xE4 villi tai musta 3.)";
    }
  } else if (!team.hasOpened && hintsOn) {
    const need = openingRequirement(team.score);
    const pts = staged.flat().reduce((s, id) => s + cardValue(findInHand(id)), 0);
    m.className = "warn";
    m.textContent = `Avaukseen tarvitaan ${need} p. Valittuna nyt ${pts} p. Sitten heit\xE4 yksi kortti.`;
  } else {
    m.textContent = "Laske sarjoja jos haluat, sitten heit\xE4 yksi kortti.";
  }
  $("pending").textContent = staged.length ? "Laskettavana: " + staged.map((g) => g.map((id) => findInHand(id).rank).join("")).join("  ") : "";
}
function flash(text, cls = "warn") {
  const m = $("msg");
  m.textContent = text;
  m.className = cls;
}
async function doDraw() {
  if (mode === "local") {
    const r = game.drawFromDeck();
    if (!r.ok) return flash(r.error);
    selected.clear();
    lastDrawnId = r.card ? r.card.id : null;
    if (game.roundOver) return endLocal();
    render();
  } else {
    const before = new Set(myHand().map((c) => c.id));
    const r = await api("/api/move", { code: net.code, seat: net.seat, move: { type: "draw" } });
    if (r.error) return flash(r.error);
    selected.clear();
    if (r.view) {
      const newHand = (r.view.players.find((p) => p.seat === net.seat) || {}).hand || [];
      const fresh = newHand.find((c) => !before.has(c.id));
      lastDrawnId = fresh ? fresh.id : null;
      handleSnapshot(r.view);
    }
  }
}
async function doTakePile() {
  if (mode === "local") {
    const r = game.takeDiscard([...selected]);
    if (!r.ok) return flash(r.error);
    selected.clear();
    flash("Otit poistopinon!", "good");
    render();
  } else {
    const r = await api("/api/move", { code: net.code, seat: net.seat, move: { type: "take", cards: [...selected] } });
    if (r.error) return flash(r.error);
    selected.clear();
    if (r.view) handleSnapshot(r.view);
  }
}
function autoFetchIds() {
  const top = V.discardTop;
  if (!top || isWild(top) || top.rank === "3") return null;
  const naturals = myHand().filter((c) => !isWild(c) && c.rank === top.rank);
  const wilds = myHand().filter(isWild);
  if (naturals.length >= 2) return [naturals[0].id, naturals[1].id];
  if (!V.frozen && naturals.length >= 1 && wilds.length >= 1) return [naturals[0].id, wilds[0].id];
  return null;
}
function onDiscardClick() {
  const ids = autoFetchIds();
  if (!ids) {
    flash("Et voi ottaa pinoa nyt (ei sopivia kortteja, tai j\xE4\xE4tynyt).", "warn");
    return;
  }
  selected = new Set(ids);
  doTakePile();
}
function stageGroup() {
  const ids = [...selected];
  const cards = ids.map(findInHand);
  const team = myTeam();
  const naturals = cards.filter((c) => !isWild(c));
  const rank = naturals[0]?.rank;
  const extendingOwn = team.hasOpened && rank && team.melds.some((m) => m.rank === rank);
  if (!extendingOwn) {
    const v = validateMeld(cards);
    if (!v.valid) return flash(v.error);
  }
  staged.push(ids);
  selected.clear();
  render();
}
async function commitMelds() {
  if (mode === "local") {
    const r = game.meld(staged);
    if (!r.ok) return flash(r.error);
    staged = [];
    selected.clear();
    const got = game.teamOf(0).melds && Object.values(game.teamOf(0).melds).some((m) => isCanasta(m));
    flash(got ? "\u2B50 Sinulla on canasta!" : "Sarjat laskettu.", "good");
    render();
  } else {
    const r = await api("/api/move", { code: net.code, seat: net.seat, move: { type: "meld", groups: staged } });
    if (r.error) return flash(r.error);
    staged = [];
    selected.clear();
    if (r.view) handleSnapshot(r.view);
  }
}
async function doDiscard() {
  const id = [...selected][0];
  lastDrawnId = null;
  if (mode === "local") {
    const r = game.discardCard(id);
    if (!r.ok) return flash(r.error);
    selected.clear();
    staged = [];
    if (game.roundOver) return endLocal();
    render();
    maybeRunBots();
  } else {
    const r = await api("/api/move", { code: net.code, seat: net.seat, move: { type: "discard", card: id } });
    if (r.error) return flash(r.error);
    selected.clear();
    staged = [];
    if (r.view) handleSnapshot(r.view);
  }
}
async function maybeRunBots() {
  if (busy || mode !== "local") return;
  busy = true;
  while (!game.roundOver && game.players[game.turn].isBot) {
    const name = game.players[game.turn].name;
    const acts = botPlayTurn(game);
    render();
    flash(`${name}: ${acts.join(", ")}`, "");
    await sleep(750);
  }
  busy = false;
  if (game.roundOver) endLocal();
  else render();
}
function endLocal() {
  render();
  showOver();
}
function showOver() {
  $("overTitle").textContent = winnerText();
  const tbl = $("overTable");
  tbl.innerHTML = "";
  V.teams.forEach((t) => {
    const names = t.playerIdxs.map((i) => V.players[i].name).join("+");
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(names)}</td><td style="text-align:right;font-weight:700">${t.score} p</td>`;
    tbl.appendChild(tr);
  });
  $("over").style.display = "flex";
}
function winnerText() {
  const WIN = 5e3;
  if (V.teams.some((t) => t.score >= WIN)) {
    const best = V.teams.reduce((a, b) => b.score > a.score ? b : a);
    return `\u{1F3C6} ${esc(best.playerIdxs.map((i) => V.players[i].name).join("+"))} voitti pelin!`;
  }
  return "Jako p\xE4\xE4ttyi \u2014 jatka seuraavaan";
}
(function initEntry() {
  if (typeof location !== "undefined") {
    const joinParam = new URLSearchParams(location.search).get("join");
    if (joinParam) {
      selectMode("online");
      if ($("joinCode")) $("joinCode").value = joinParam.toUpperCase();
    }
  }
  const sess = loadSession();
  if (sess && sess.code) {
    if ($("resume")) $("resume").style.display = "";
    if ($("resumeCode")) $("resumeCode").textContent = sess.code;
    if ($("resumeBtn")) $("resumeBtn").onclick = () => {
      hintsOn = !!cfg.hints;
      document.body.classList.toggle("big", !!cfg.big);
      openNet(sess.code, sess.seat);
    };
    if ($("resumeDismiss")) $("resumeDismiss").onclick = () => {
      clearSession();
      if ($("resume")) $("resume").style.display = "none";
    };
  }
})();
