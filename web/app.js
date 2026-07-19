// Mökki-Canasta — käyttöliittymä. Kaksi tilaa: paikallinen (botit) ja verkkopeli (huone + SSE).
import { Game } from '../src/game.js';
import { botPlayTurn } from '../src/bot.js';
import { isWild, isRedThree, isBlackThree, cardValue } from '../src/cards.js';
import { validateMeld, isCanasta } from '../src/melds.js';
import { openingRequirement } from '../src/scoring.js';
import qrcode from 'qrcode-generator';

const $ = (id) => document.getElementById(id);

// --- Sessio (reconnect): tallenna huone+paikka, jotta sivun lataus liittää takaisin ---
const SESSION_KEY = 'mokkiCanasta.session';
function saveSession(code, seat) { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code, seat })); } catch {} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUIT = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RED = (c) => c.suit === 'H' || c.suit === 'D';
const esc = (s) => String(s).replace(/[<>&"']/g, (ch) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---------- Tila ----------
let cfg = { mode: 'local', players: 3, hints: 1, big: 0 };
let mode = 'local';
let game = null;               // paikallinen peli
let net = null;                // { code, seat, es }
let V = null;                  // normalisoitu näkymä (molemmat tilat)
let selected = new Set();
let staged = [];
let hintsOn = true;
let busy = false;
let lastDrawnId = null; // juuri nostettu kortti korostusta varten
let scrolledForId = null; // ettei vieritetä joka renderillä

// ---------- Aloitusnäytön kytkennät ----------
function bindOpts(containerId, attr, key, after) {
  $(containerId).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(containerId).children].forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    cfg[key] = isNaN(Number(b.dataset[attr])) ? b.dataset[attr] : Number(b.dataset[attr]);
    if (after) after();
  });
}
function selectMode(m) {
  cfg.mode = m;
  [...$('modeOpt').children].forEach((b) => b.classList.toggle('sel', b.dataset.m === m));
  const online = m === 'online';
  $('onlineJoin').style.display = online ? '' : 'none';
  $('startBtn').textContent = online ? 'Luo huone' : 'Aloita peli';
}
bindOpts('modeOpt', 'm', 'mode', () => selectMode(cfg.mode));
bindOpts('playerCount', 'n', 'players');
bindOpts('hintOpt', 'h', 'hints');
bindOpts('bigOpt', 'b', 'big');

$('startBtn').onclick = () => {
  hintsOn = !!cfg.hints;
  document.body.classList.toggle('big', !!cfg.big);
  if (cfg.mode === 'online') createRoom();
  else startLocal();
};
$('joinBtn').onclick = () => {
  hintsOn = !!cfg.hints;
  document.body.classList.toggle('big', !!cfg.big);
  joinRoom();
};
$('hintChk').onchange = (e) => { hintsOn = e.target.checked; render(); };
$('lobbyStart').onclick = async () => { await api('/api/start', { code: net.code }); pollOnce(); };
function newDeal() {
  if (mode === 'online') { api('/api/next', { code: net.code }).then(pollOnce); $('over').style.display = 'none'; return; }
  const scores = game.teams.map((t) => t.score);
  const players = game.players.map((p) => ({ name: p.name, isBot: p.isBot }));
  game = new Game({ players, startScores: scores });
  selected = new Set(); staged = [];
  $('over').style.display = 'none';
  render(); maybeRunBots();
}
$('againBtn').onclick = newDeal;

function myName() { return ($('playerName') && $('playerName').value) || 'Sinä'; }

// ---------- Paikallinen tila ----------
function startLocal() {
  mode = 'local';
  clearSession();
  const names = [myName(), 'Botti 1', 'Botti 2', 'Botti 3'];
  const players = [];
  for (let i = 0; i < cfg.players; i++) players.push({ name: names[i], isBot: i !== 0 });
  game = new Game({ players });
  selected = new Set(); staged = [];
  $('setup').style.display = 'none';
  $('game').style.display = 'flex';
  $('hintChk').checked = hintsOn;
  render(); maybeRunBots();
}

// ---------- Verkkotila ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ error: 'Verkkovirhe' }));
}

async function createRoom() {
  const r = await api('/api/create', { name: myName(), seats: cfg.players });
  if (r.error) return alert(r.error);
  openNet(r.code, r.seat);
}
async function joinRoom() {
  const code = ($('joinCode').value || '').toUpperCase();
  if (code.length !== 4) return alert('Anna 4-merkkinen koodi');
  const r = await api('/api/join', { code, name: myName() });
  if (r.error) return alert(r.error);
  openNet(r.code, r.seat);
}

function openNet(code, seat) {
  mode = 'online';
  net = { code, seat, lastVersion: 0 };
  selected = new Set(); staged = [];
  saveSession(code, seat);
  $('setup').style.display = 'none';
  $('resume') && ($('resume').style.display = 'none');
  $('hintChk').checked = hintsOn;
  pollOnce();
  net.timer = setInterval(pollOnce, 1500);
}

// Palaa aloitusnäyttöön (esim. huone kadonnut) ja lopeta pollaus.
function leaveToSetup(msg) {
  if (net && net.timer) clearInterval(net.timer);
  net = null; mode = 'local'; clearSession();
  $('game').style.display = 'none';
  $('lobby').style.display = 'none';
  $('over').style.display = 'none';
  $('setup').style.display = '';
  if (msg) alert(msg);
}

// Pollaa serverin tila. Versiovahti estää turhat renderöinnit ja oman vuoron klobbaamisen.
async function pollOnce() {
  if (!net) return;
  try {
    const res = await fetch(`/api/state?code=${net.code}&seat=${net.seat}`);
    const snap = await res.json();
    if (snap.error) {
      if (/löydy/i.test(snap.error)) leaveToSetup('Huone ei ole enää voimassa. Aloita uusi peli.');
      return;
    }
    handleSnapshot(snap);
  } catch { /* verkko pätkii — yritetään taas seuraavalla kierroksella */ }
}

function handleSnapshot(snap) {
  if (!snap || snap.error) return;
  if (typeof snap.version === 'number') {
    if (snap.version <= net.lastVersion) return; // ei muutosta -> ei kosketa selektioihin
    net.lastVersion = snap.version;
  }
  if (snap.type === 'lobby') {
    $('game').style.display = 'none';
    $('over').style.display = 'none';
    renderLobby(snap);
    return;
  }
  $('lobby').style.display = 'none';
  $('game').style.display = 'flex';
  V = normalizeView(snap);
  paint();
  if (V.roundOver) showOver(); else $('over').style.display = 'none';
}

function renderLobby(snap) {
  $('lobby').style.display = 'block';
  $('lobbyCode').textContent = snap.code;
  // QR-koodi liittymislinkistä
  if ($('lobbyQR') && typeof location !== 'undefined') {
    const url = `${location.origin}/?join=${snap.code}`;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('lobbyQR').innerHTML = qr.createImgTag(5, 10);
  }
  const list = snap.seats.map((s, i) =>
    `<div>${i + 1}. ${esc(s.name)}${i === snap.you ? ' (sinä)' : ''}</div>`).join('');
  const empty = snap.seatCount - snap.seats.length;
  $('lobbyPlayers').innerHTML = list +
    (empty > 0 ? `<div style="opacity:.6">+ ${empty} paikkaa (täytetään boteilla)</div>` : '');
  const isHost = snap.you === 0;
  $('lobbyStart').style.display = isHost ? '' : 'none';
  $('lobbyHint').textContent = isHost
    ? 'Kun kaikki ovat liittyneet, paina Aloita peli.'
    : 'Odota että huoneen luoja aloittaa pelin…';
}

// ---------- Normalisointi (molemmat tilat -> V) ----------
function normalizeLocal() {
  const seat = 0;
  return {
    seat, phase: game.phase, turn: game.turn, frozen: game.frozen,
    roundOver: game.roundOver, deckCount: game.deck.length,
    discardTop: game.topDiscard(), discardCount: game.discard.length,
    players: game.players.map((p, i) => ({
      seat: i, name: p.name, isBot: p.isBot, teamId: p.teamId,
      handCount: p.hand.length, hand: i === seat ? p.hand : null,
    })),
    teams: game.teams.map((t) => ({
      id: t.id, playerIdxs: t.playerIdxs, redThrees: t.redThrees,
      hasOpened: t.hasOpened, score: t.score,
      melds: Object.entries(t.melds).map(([rank, cards]) => ({ rank, cards, canasta: isCanasta(cards) })),
    })),
  };
}
function normalizeView(snap) {
  return {
    seat: snap.seat, phase: snap.phase, turn: snap.turn, frozen: snap.frozen,
    roundOver: snap.roundOver, deckCount: snap.deckCount,
    discardTop: snap.discardTop, discardCount: snap.discardCount,
    players: snap.players,
    teams: snap.teams.map((t) => ({
      ...t,
      melds: Object.entries(t.melds).map(([rank, m]) => ({ rank, cards: m.cards, canasta: m.canasta })),
    })),
  };
}

function myTeam() { return V.teams.find((t) => t.playerIdxs.includes(V.seat)); }
function myHand() { return V.players.find((p) => p.seat === V.seat).hand || []; }
function findInHand(id) { return myHand().find((c) => c.id === id); }

// ---------- Kortin piirto ----------
function cardEl(card, { small = false, faceDown = false } = {}) {
  const d = document.createElement('div');
  d.className = 'card' + (small ? ' small' : '');
  if (faceDown) { d.classList.add('back'); return d; }
  if (card.rank === 'JOKER') { d.classList.add('joker'); d.innerHTML = `<div class="r">★</div><div class="s">JOKER</div>`; return d; }
  if (RED(card)) d.classList.add('red');
  d.innerHTML = `<div class="r">${card.rank}</div><div class="s">${SUIT[card.suit]}</div>`;
  return d;
}

// ---------- Render ----------
function render() {
  if (mode === 'local') { V = normalizeLocal(); }
  if (!V) return;
  paint();
}

function hintRanks() {
  const counts = {};
  for (const c of myHand()) if (!isWild(c) && c.rank !== '3') counts[c.rank] = (counts[c.rank] || 0) + 1;
  const team = myTeam();
  const set = new Set();
  for (const [r, n] of Object.entries(counts)) if (n >= 3) set.add(r);
  for (const m of team.melds) if (counts[m.rank]) set.add(m.rank);
  return set;
}

function paint() {
  const myTurn = V.turn === V.seat && !V.roundOver;

  $('scores').textContent = V.teams
    .map((t) => `${t.playerIdxs.map((i) => V.players[i].name).join('+')}: ${t.score}`).join('   |   ');
  const cur = V.players[V.turn];
  $('turnInfo').textContent = V.roundOver ? 'Jako päättyi'
    : (myTurn ? '➡️ Sinun vuorosi' : `Vuorossa: ${esc(cur.name)}`);

  const opp = $('opponents'); opp.innerHTML = '';
  V.players.forEach((p) => {
    if (p.seat === V.seat) return;
    const team = V.teams.find((t) => t.id === p.teamId);
    const melds = team.melds.map((m) => `${m.rank}×${m.cards.length}${m.canasta ? '⭐' : ''}`).join(' ');
    const el = document.createElement('div');
    el.className = 'opp' + (V.turn === p.seat ? ' active' : '');
    el.innerHTML = `<div class="name">${esc(p.name)}${p.isBot ? ' 🤖' : ''}</div>
      <div class="cnt">${p.handCount} korttia${team.hasOpened ? ' · avannut' : ''}</div>
      <div class="melds">${melds || '—'}</div>`;
    opp.appendChild(el);
  });

  $('deckCount').textContent = V.deckCount;
  $('deck').innerHTML = ''; $('deck').appendChild(cardEl(null, { faceDown: true }));
  $('discard').innerHTML = '';
  if (V.discardTop) $('discard').appendChild(cardEl(V.discardTop));
  $('discardCap').textContent = 'Poistopino' + (V.frozen ? ' 🧊 (jäätynyt)' : '');

  const mm = $('myMelds'); mm.innerHTML = '';
  const team = myTeam();
  if (!team.melds.length) mm.innerHTML = '<span style="opacity:.6">Ei vielä sarjoja</span>';
  for (const m of team.melds) {
    const g = document.createElement('div'); g.className = 'meldgroup';
    g.innerHTML = `<span class="lbl">${m.rank}</span>`;
    m.cards.forEach((c) => g.appendChild(cardEl(c, { small: true })));
    if (m.canasta) {
      const b = document.createElement('span'); b.className = 'canasta-badge';
      b.textContent = m.cards.every((x) => !isWild(x)) ? '⭐500' : '⭐300';
      g.appendChild(b);
    }
    mm.appendChild(g);
  }

  const hints = hintsOn ? hintRanks() : new Set();
  const stagedIds = new Set(staged.flat());
  const hand = $('hand'); hand.innerHTML = '';
  const order = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'JOKER'];
  const sorted = [...myHand()].sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
  for (const c of sorted) {
    const el = cardEl(c);
    if (stagedIds.has(c.id)) { el.style.opacity = '.25'; }
    else {
      if (selected.has(c.id)) el.classList.add('sel');
      if (hints.has(c.rank) && !isWild(c)) el.classList.add('hint');
      if (c.id === lastDrawnId) {
        el.classList.add('justdrew');
        if (lastDrawnId !== scrolledForId && el.scrollIntoView) {
          scrolledForId = lastDrawnId;
          setTimeout(() => el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 40);
        }
      }
      el.onclick = () => { if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id); render(); };
    }
    hand.appendChild(el);
  }

  renderActions(myTurn);
  renderMessage(myTurn, hints);
}

function renderActions(myTurn) {
  const a = $('actions'); a.innerHTML = '';
  if (!myTurn) return;
  const mk = (label, primary, disabled, fn) => {
    const b = document.createElement('button');
    b.textContent = label; if (primary) b.className = 'primary';
    b.disabled = !!disabled; if (!disabled) b.onclick = fn;
    a.appendChild(b);
  };
  if (V.phase === 'draw') {
    mk('Nosta pakasta', true, false, doDraw);
    const canTake = mode === 'local'
      ? game.canTakeDiscard([...selected]).ok
      : (selected.size >= 1 && V.discardTop);
    mk('Ota poistopino', false, !canTake, doTakePile);
  } else if (V.phase === 'action') {
    // Umpikuja: kädessä ei laillista heittoa (0 korttia, tai 1 kortti ilman canastaa).
    const canGoOut = myTeam().melds.some((m) => m.canasta);
    const stuck = myHand().length === 0 || (myHand().length === 1 && !canGoOut);
    if (stuck) {
      flash('Jäit umpikujaan (ei korttia heittoon ilman ulos menoa). Aloita uusi jako.', 'warn');
      mk('🔄 Uusi jako', true, false, newDeal);
      return;
    }
    mk('Lisää ryhmä', false, selected.size < 1, stageGroup);
    mk('Laske pöytään', false, staged.length === 0, commitMelds);
    if (staged.length) mk('Peru laskut', false, false, () => { staged = []; render(); });
    mk('Heitä valittu', true, selected.size !== 1, doDiscard);
  }
}

function renderMessage(myTurn, hints) {
  const m = $('msg'); m.className = '';
  if (V.roundOver) { m.textContent = 'Jako päättyi.'; $('pending').textContent = ''; return; }
  if (!myTurn) { m.textContent = ''; $('pending').textContent = ''; return; }
  const team = myTeam();
  if (V.phase === 'draw') {
    m.textContent = 'Nosta pakasta — tai valitse 2 samaa kuin pinon päällin kortti ja ota pino.';
  } else if (!team.hasOpened && hintsOn) {
    const need = openingRequirement(team.score);
    const pts = staged.flat().reduce((s, id) => s + cardValue(findInHand(id)), 0);
    m.className = 'warn';
    m.textContent = `Avaukseen tarvitaan ${need} p. Valittuna nyt ${pts} p. Sitten heitä yksi kortti.`;
  } else {
    m.textContent = 'Laske sarjoja jos haluat, sitten heitä yksi kortti.';
  }
  $('pending').textContent = staged.length
    ? 'Laskettavana: ' + staged.map((g) => g.map((id) => findInHand(id).rank).join('')).join('  ') : '';
}

function flash(text, cls = 'warn') { const m = $('msg'); m.textContent = text; m.className = cls; }

// ---------- Siirrot (haarautuu tilan mukaan) ----------
async function doDraw() {
  if (mode === 'local') {
    const r = game.drawFromDeck(); if (!r.ok) return flash(r.error);
    selected.clear();
    lastDrawnId = r.card ? r.card.id : null;
    if (game.roundOver) return endLocal(); render();
  } else {
    const before = new Set(myHand().map((c) => c.id));
    const r = await api('/api/move', { code: net.code, seat: net.seat, move: { type: 'draw' } });
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
  if (mode === 'local') {
    const r = game.takeDiscard([...selected]); if (!r.ok) return flash(r.error);
    selected.clear(); flash('Otit poistopinon!', 'good'); render();
  } else {
    const r = await api('/api/move', { code: net.code, seat: net.seat, move: { type: 'take', cards: [...selected] } });
    if (r.error) return flash(r.error); selected.clear(); if (r.view) handleSnapshot(r.view);
  }
}
function stageGroup() {
  const ids = [...selected]; const cards = ids.map(findInHand);
  const team = myTeam();
  const naturals = cards.filter((c) => !isWild(c));
  const rank = naturals[0]?.rank;
  const extendingOwn = team.hasOpened && rank && team.melds.some((m) => m.rank === rank);
  if (!extendingOwn) { const v = validateMeld(cards); if (!v.valid) return flash(v.error); }
  staged.push(ids); selected.clear(); render();
}
async function commitMelds() {
  if (mode === 'local') {
    const r = game.meld(staged); if (!r.ok) return flash(r.error);
    staged = []; selected.clear();
    const got = game.teamOf(0).melds && Object.values(game.teamOf(0).melds).some((m) => isCanasta(m));
    flash(got ? '⭐ Sinulla on canasta!' : 'Sarjat laskettu.', 'good'); render();
  } else {
    const r = await api('/api/move', { code: net.code, seat: net.seat, move: { type: 'meld', groups: staged } });
    if (r.error) return flash(r.error); staged = []; selected.clear(); if (r.view) handleSnapshot(r.view);
  }
}
async function doDiscard() {
  const id = [...selected][0];
  lastDrawnId = null; // vuoro päättyy, korostus pois
  if (mode === 'local') {
    const r = game.discardCard(id); if (!r.ok) return flash(r.error);
    selected.clear(); staged = []; if (game.roundOver) return endLocal(); render(); maybeRunBots();
  } else {
    const r = await api('/api/move', { code: net.code, seat: net.seat, move: { type: 'discard', card: id } });
    if (r.error) return flash(r.error); selected.clear(); staged = []; if (r.view) handleSnapshot(r.view);
  }
}

// ---------- Bottien vuorot (vain paikallinen) ----------
async function maybeRunBots() {
  if (busy || mode !== 'local') return;
  busy = true;
  while (!game.roundOver && game.players[game.turn].isBot) {
    const name = game.players[game.turn].name;
    const acts = botPlayTurn(game);
    render(); flash(`${name}: ${acts.join(', ')}`, ''); await sleep(750);
  }
  busy = false;
  if (game.roundOver) endLocal(); else render();
}

// ---------- Jaon loppu ----------
function endLocal() { render(); showOver(); }
function showOver() {
  $('overTitle').textContent = winnerText();
  const tbl = $('overTable'); tbl.innerHTML = '';
  V.teams.forEach((t) => {
    const names = t.playerIdxs.map((i) => V.players[i].name).join('+');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(names)}</td><td style="text-align:right;font-weight:700">${t.score} p</td>`;
    tbl.appendChild(tr);
  });
  $('over').style.display = 'flex';
}
function winnerText() {
  const WIN = 5000;
  if (V.teams.some((t) => t.score >= WIN)) {
    const best = V.teams.reduce((a, b) => (b.score > a.score ? b : a));
    return `🏆 ${esc(best.playerIdxs.map((i) => V.players[i].name).join('+'))} voitti pelin!`;
  }
  return 'Jako päättyi — jatka seuraavaan';
}

// ---------- Käynnistys: ?join=KOODI + keskeneräisen pelin jatko (reconnect) ----------
(function initEntry() {
  if (typeof location !== 'undefined') {
    const joinParam = new URLSearchParams(location.search).get('join');
    if (joinParam) {
      selectMode('online');
      if ($('joinCode')) $('joinCode').value = joinParam.toUpperCase();
    }
  }
  const sess = loadSession();
  if (sess && sess.code) {
    if ($('resume')) $('resume').style.display = '';
    if ($('resumeCode')) $('resumeCode').textContent = sess.code;
    if ($('resumeBtn')) $('resumeBtn').onclick = () => {
      hintsOn = !!cfg.hints;
      document.body.classList.toggle('big', !!cfg.big);
      openNet(sess.code, sess.seat);
    };
    if ($('resumeDismiss')) $('resumeDismiss').onclick = () => {
      clearSession();
      if ($('resume')) $('resume').style.display = 'none';
    };
  }
})();
