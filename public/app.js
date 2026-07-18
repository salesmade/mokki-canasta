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

// web/app.js
var $ = (id) => document.getElementById(id);
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
var busy = false;
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
bindOpts("modeOpt", "m", "mode", () => {
  const online = cfg.mode === "online";
  $("onlineJoin").style.display = online ? "" : "none";
  $("startBtn").textContent = online ? "Luo huone" : "Aloita peli";
});
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
$("lobbyStart").onclick = async () => {
  await api("/api/start", { code: net.code });
  pollOnce();
};
$("againBtn").onclick = () => {
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
};
function myName() {
  return $("playerName") && $("playerName").value || "Sin\xE4";
}
function startLocal() {
  mode = "local";
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
  $("setup").style.display = "none";
  $("hintChk").checked = hintsOn;
  pollOnce();
  net.timer = setInterval(pollOnce, 1500);
}
async function pollOnce() {
  if (!net) return;
  try {
    const res = await fetch(`/api/state?code=${net.code}&seat=${net.seat}`);
    const snap = await res.json();
    if (!snap.error) handleSnapshot(snap);
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
      hand: i === seat ? p.hand : null
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
    opp.appendChild(el);
  });
  $("deckCount").textContent = V.deckCount;
  $("deck").innerHTML = "";
  $("deck").appendChild(cardEl(null, { faceDown: true }));
  $("discard").innerHTML = "";
  if (V.discardTop) $("discard").appendChild(cardEl(V.discardTop));
  $("discardCap").textContent = "Poistopino" + (V.frozen ? " \u{1F9CA} (j\xE4\xE4tynyt)" : "");
  const mm = $("myMelds");
  mm.innerHTML = "";
  const team = myTeam();
  if (!team.melds.length) mm.innerHTML = '<span style="opacity:.6">Ei viel\xE4 sarjoja</span>';
  for (const m of team.melds) {
    const g = document.createElement("div");
    g.className = "meldgroup";
    g.innerHTML = `<span class="lbl">${m.rank}</span>`;
    m.cards.forEach((c) => g.appendChild(cardEl(c, { small: true })));
    if (m.canasta) {
      const b = document.createElement("span");
      b.className = "canasta-badge";
      b.textContent = m.cards.every((x) => !isWild(x)) ? "\u2B50500" : "\u2B50300";
      g.appendChild(b);
    }
    mm.appendChild(g);
  }
  const hints = hintsOn ? hintRanks() : /* @__PURE__ */ new Set();
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
    m.textContent = "Nosta pakasta \u2014 tai valitse 2 samaa kuin pinon p\xE4\xE4llin kortti ja ota pino.";
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
    if (game.roundOver) return endLocal();
    render();
  } else {
    const r = await api("/api/move", { code: net.code, seat: net.seat, move: { type: "draw" } });
    if (r.error) return flash(r.error);
    selected.clear();
    if (r.view) handleSnapshot(r.view);
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
