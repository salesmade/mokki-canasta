// Päästä-päähän-integraatiotesti: oikea serveri (muistitallennus), pollaava API, 2 ihmispelaajaa.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5273;
const base = `http://localhost:${PORT}`;
let fail = 0;
const ok = (c, m) => { if (!c) { console.error('  ✗', m); fail++; } else console.log('  ✓', m); };

const post = async (p, b) => (await fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json();
const state = async (code, seat) => (await fetch(`${base}/api/state?code=${code}&seat=${seat}`)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = spawn('node', ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  await new Promise((resolve) => srv.stdout.on('data', (d) => { if (String(d).includes('Mökki-Canasta')) resolve(); }));

  try {
    // 1) Luo huone (2 paikkaa, 2 ihmistä)
    const created = await post('/api/create', { name: 'Aimo', seats: 2 });
    ok(created.code && created.seat === 0, 'huone luotu ' + created.code);

    // 2) Aula näkyy pollauksella
    let lobby = await state(created.code, 0);
    ok(lobby.type === 'lobby' && lobby.seats.length === 1, 'aula: 1 pelaaja');

    // 3) Toinen ihminen liittyy
    const joined = await post('/api/join', { code: created.code, name: 'Anneli' });
    ok(joined.seat === 1, 'Anneli liittyi paikalle 1');
    lobby = await state(created.code, 0);
    ok(lobby.seats.length === 2, 'aula päivittyi: 2 pelaajaa');

    // 4) Aloita peli (ei botteja, molemmat ihmisiä)
    ok((await post('/api/start', { code: created.code })).ok, 'peli aloitettu');

    // 5) Sensurointi: kumpikin näkee vain oman kätensä
    const v0 = await state(created.code, 0);
    const v1 = await state(created.code, 1);
    ok(v0.type === 'game', 'peli käynnissä');
    ok(Array.isArray(v0.players[0].hand) && v0.players[1].hand === null, 'seat0 näkee vain omansa');
    ok(Array.isArray(v1.players[1].hand) && v1.players[0].hand === null, 'seat1 näkee vain omansa');
    ok(v0.version === v1.version, 'sama versio molemmille');

    // 6) Pelaa muutama vuoro vuorotellen ihmiseltä ihmiselle
    let turns = 0;
    while (turns < 6) {
      const v = await state(created.code, 0);
      if (v.roundOver) break;
      const seat = v.turn;
      const before = v.version;
      const dr = await post('/api/move', { code: created.code, seat, move: { type: 'draw' } });
      ok(dr.ok, `seat ${seat} nosti (vuoro ${turns})`);
      const me = dr.view.players[seat].hand;
      const di = await post('/api/move', { code: created.code, seat, move: { type: 'discard', card: me[me.length - 1].id } });
      ok(di.ok && di.view.version > before, `seat ${seat} heitti, versio kasvoi`);
      ok(di.view.turn !== seat || di.view.roundOver, 'vuoro vaihtui toiselle ihmiselle');
      turns++;
    }

    // 7) Väärän vuoron esto
    const cur = await state(created.code, 0);
    if (!cur.roundOver) {
      const wrongSeat = (cur.turn + 1) % 2;
      ok((await post('/api/move', { code: created.code, seat: wrongSeat, move: { type: 'draw' } })).error, 'ei-vuorossa siirto hylätty');
    }
  } finally {
    srv.kill();
  }

  console.log(fail ? `\nFAIL: ${fail} virhettä` : '\nKAIKKI OK');
  process.exit(fail ? 1 : 0);
}
main();
