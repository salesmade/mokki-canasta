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
    return { valid: false, error: "Kolmosia ei lasketa normaalina sarjana" };
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
  return 50;
}
var GO_OUT_BONUS = 100;
var RED_THREE_EACH = 100;
var ALL_RED_THREES = 800;
function redThreeScore(count, hasOpened) {
  if (count <= 0) return 0;
  const value = count >= 4 ? ALL_RED_THREES : count * RED_THREE_EACH;
  return hasOpened ? value : -value;
}
function scoreTeamHand(team) {
  const meldPoints = team.melds.reduce((sum, m) => sum + meldScore(m), 0);
  const goOut = team.wentOut ? GO_OUT_BONUS : 0;
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
        wentOut
      });
      team.score += r.total;
      return { teamId: team.id, ...r, newScore: team.score };
    });
    return this._ok({ roundOver: true, reason, results });
  }
};

// src/bot.js
function groupByRank(hand) {
  const groups = {};
  for (const c of hand) {
    if (isWild(c) || c.rank === "3") continue;
    (groups[c.rank] ||= []).push(c);
  }
  return groups;
}
function botPlayTurn(game) {
  const actions = [];
  const player = game.current();
  const team = game.teamOf(game.turn);
  const top = game.topDiscard();
  let took = false;
  if (top && !isBlackThree(top) && !isWild(top) && top.rank !== "3") {
    const matches = player.hand.filter((c) => !isWild(c) && c.rank === top.rank);
    if (team.hasOpened && matches.length >= 2) {
      const r2 = game.takeDiscard([matches[0].id, matches[1].id]);
      if (r2.ok) {
        took = true;
        actions.push("ota pino");
      }
    }
  }
  if (!took) {
    game.drawFromDeck();
    actions.push("nosta pakasta");
    if (game.roundOver) return actions;
  }
  const minKeep = () => game.teamHasCanasta(team) ? 1 : 2;
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
      const r2 = game.meld(chosen);
      if (r2.ok) actions.push("avaus");
    }
  }
  if (team.hasOpened) {
    const groups = groupByRank(player.hand);
    for (const [rank, cs] of Object.entries(groups)) {
      if (team.melds[rank]) {
        if (cs.length >= 1 && player.hand.length - cs.length >= minKeep()) {
          const r2 = game.meld([cs.map((c) => c.id)]);
          if (r2.ok) actions.push(`jatka ${rank}`);
        }
      } else if (cs.length >= 3 && player.hand.length - cs.length >= minKeep()) {
        const r2 = game.meld([cs.map((c) => c.id)]);
        if (r2.ok) actions.push(`sarja ${rank}`);
      }
    }
  }
  const cardId = chooseDiscard(game, player, team);
  const r = game.discardCard(cardId);
  if (!r.ok) {
    for (const c of player.hand) {
      const rr = game.discardCard(c.id);
      if (rr.ok) {
        actions.push("heitto (vara)");
        return actions;
      }
    }
  }
  actions.push("heitto");
  return actions;
}
function chooseDiscard(game, player, team) {
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

// src/online.js
var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(rng = Math.random) {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}
function cleanName(name) {
  return String(name || "Pelaaja").replace(/[<>&"']/g, "").slice(0, 20).trim() || "Pelaaja";
}
function viewFor(game, seat) {
  const top = game.topDiscard();
  return {
    seat,
    phase: game.phase,
    turn: game.turn,
    frozen: game.frozen,
    roundOver: game.roundOver,
    wentOutPlayer: game.wentOutPlayer,
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    discardTop: top,
    players: game.players.map((p, i) => ({
      seat: i,
      name: p.name,
      isBot: p.isBot,
      teamId: p.teamId,
      handCount: p.hand.length,
      // Vain oma kasi paljastetaan.
      hand: i === seat ? p.hand : null
    })),
    teams: game.teams.map((t) => ({
      id: t.id,
      playerIdxs: t.playerIdxs,
      melds: Object.fromEntries(
        Object.entries(t.melds).map(([r, m]) => [r, { cards: m, canasta: isCanasta(m) }])
      ),
      redThrees: t.redThrees,
      hasOpened: t.hasOpened,
      score: t.score
    })),
    log: game.log.slice(-6)
  };
}

// src/rooms-core.js
var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));
function runBots(g) {
  let guard = 0;
  while (!g.roundOver && g.players[g.turn].isBot && guard < 500) {
    botPlayTurn(g);
    guard++;
  }
}
function createRoomData(hostName, seatCount, code) {
  return {
    code,
    seatCount: clamp(seatCount || 4, 2, 4),
    seats: [{ name: cleanName(hostName), isBot: false }],
    state: null,
    version: 1
  };
}
function joinRoomData(room, name) {
  if (room.state) return { error: "Peli on jo alkanut" };
  if (room.seats.length >= room.seatCount) return { error: "Huone t\xE4ynn\xE4" };
  room.seats.push({ name: cleanName(name), isBot: false });
  room.version++;
  return { seat: room.seats.length - 1 };
}
function startRoomData(room, rng, startScores = null) {
  if (room.state) return { error: "Peli on jo alkanut" };
  const players = [];
  for (let i = 0; i < room.seatCount; i++) {
    const s = room.seats[i];
    if (s) players.push({ name: s.name, isBot: !!s.isBot });
    else {
      const b = { name: `Botti ${i}`, isBot: true };
      players.push(b);
      room.seats[i] = b;
    }
  }
  const g = new Game({ players, rng, startScores });
  runBots(g);
  room.state = g.serialize();
  room.version++;
  return { ok: true };
}
function moveRoomData(room, seat, move) {
  if (!room.state) return { error: "Ei peli\xE4" };
  const g = Game.fromState(room.state);
  if (g.roundOver) return { error: "Jako on p\xE4\xE4ttynyt" };
  if (g.turn !== seat) return { error: "Ei sinun vuorosi" };
  let r;
  switch (move && move.type) {
    case "draw":
      r = g.drawFromDeck();
      break;
    case "take":
      r = g.takeDiscard(move.cards || []);
      break;
    case "meld":
      r = g.meld(move.groups || []);
      break;
    case "discard":
      r = g.discardCard(move.card);
      break;
    default:
      return { error: "Tuntematon siirto" };
  }
  if (!r.ok) return r;
  runBots(g);
  room.state = g.serialize();
  room.version++;
  return { ok: true };
}
function nextRoomData(room, rng) {
  if (!room.state) return { error: "Ei peli\xE4" };
  const g = Game.fromState(room.state);
  const startScores = g.teams.map((t) => t.score);
  const players = g.players.map((p) => ({ name: p.name, isBot: p.isBot }));
  const ng = new Game({ players, rng, startScores });
  runBots(ng);
  room.state = ng.serialize();
  room.version++;
  return { ok: true };
}
function redactRoom(room, seat) {
  if (!room.state) {
    return {
      type: "lobby",
      code: room.code,
      seatCount: room.seatCount,
      version: room.version,
      seats: room.seats.map((s) => ({ name: s.name, isBot: !!s.isBot })),
      you: seat
    };
  }
  return { type: "game", code: room.code, version: room.version, ...viewFor(Game.fromState(room.state), seat) };
}

// src/api-handlers.js
function makeApi(store, rng = Math.random) {
  return {
    async create({ name, seats } = {}) {
      let code;
      do {
        code = makeCode(rng);
      } while (await store.getRoom(code));
      const room = createRoomData(name, seats, code);
      await store.saveRoom(room);
      return { code, seat: 0 };
    },
    async join({ code, name } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: "Huonetta ei l\xF6ydy" };
      const r = joinRoomData(room, name);
      if (r.error) return r;
      await store.saveRoom(room);
      return { code: room.code, seat: r.seat };
    },
    async start({ code } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: "Huonetta ei l\xF6ydy" };
      const r = startRoomData(room, rng);
      if (r.error) return r;
      await store.saveRoom(room);
      return { ok: true };
    },
    async next({ code } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: "Huonetta ei l\xF6ydy" };
      const r = nextRoomData(room, rng);
      if (r.error) return r;
      await store.saveRoom(room);
      return { ok: true };
    },
    async move({ code, seat, move } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: "Huonetta ei l\xF6ydy" };
      const r = moveRoomData(room, Number(seat), move);
      if (r.error) return r;
      await store.saveRoom(room);
      return { ok: true, view: redactRoom(room, Number(seat)) };
    },
    async state({ code, seat } = {}) {
      const room = await store.getRoom(code);
      if (!room) return { error: "Huonetta ei l\xF6ydy" };
      return redactRoom(room, Number(seat));
    }
  };
}

// src/store-supabase.js
function supabaseStore(env = process.env) {
  const URL = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  const TABLE = env.CANASTA_TABLE || "canasta_rooms";
  if (!URL || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY puuttuu");
  const headers = {
    apikey: KEY,
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json"
  };
  return {
    async getRoom(code) {
      const c = String(code || "").toUpperCase();
      const res = await fetch(`${URL}/rest/v1/${TABLE}?code=eq.${encodeURIComponent(c)}&select=data`, { headers });
      if (!res.ok) throw new Error("Supabase get virhe " + res.status);
      const rows = await res.json();
      return rows[0]?.data || null;
    },
    async saveRoom(room) {
      const res = await fetch(`${URL}/rest/v1/${TABLE}?on_conflict=code`, {
        method: "POST",
        headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ code: room.code, data: room, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
      if (!res.ok) throw new Error("Supabase save virhe " + res.status);
    }
  };
}

// functions/_lib.js
function api() {
  return makeApi(supabaseStore());
}
function send(res, obj) {
  res.status(obj && obj.error ? 400 : 200).json(obj);
}
async function run(res, fn) {
  try {
    send(res, await fn());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Sis\xE4inen virhe" });
  }
}

// functions/state.js
async function handler(req, res) {
  const { code, seat } = req.query || {};
  run(res, async () => api().state({ code, seat }));
}
export {
  handler as default
};
