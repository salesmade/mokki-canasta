// Paikallinen dev-serveri: staattiset tiedostot + sama API kuin Vercelissä (pollaus).
// Tallennus: muisti (oletus) tai Supabase jos SUPABASE_URL + SUPABASE_SERVICE_KEY on asetettu.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApi } from './src/api-handlers.js';
import { memoryStore } from './src/store-memory.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5173;

// Valitse tallennus. Supabase vain jos env on; muuten muisti.
let store = memoryStore();
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  const { supabaseStore } = await import('./src/store-supabase.js');
  store = supabaseStore();
  console.log('Store: Supabase');
} else {
  console.log('Store: muisti (paikallinen)');
}
const apiInst = makeApi(store);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function readJson(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
function sendJson(res, obj) {
  res.writeHead(obj && obj.error ? 400 : 200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, path, url) {
  try {
    if (req.method === 'GET' && path === '/api/state') {
      return sendJson(res, await apiInst.state({ code: url.searchParams.get('code'), seat: url.searchParams.get('seat') }));
    }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const b = await readJson(req);
    const fn = path.slice('/api/'.length);
    if (['create', 'join', 'start', 'next', 'move'].includes(fn)) {
      return sendJson(res, await apiInst[fn](b));
    }
    res.writeHead(404); res.end('no route');
  } catch (e) { sendJson(res, { error: String(e.message || e) }); }
}

const PUBLIC = join(ROOT, 'public');
async function handleStatic(req, res, path) {
  try {
    if (path === '/') path = '/index.html';
    const full = normalize(join(PUBLIC, path));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
    const data = await readFile(full);
    res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith('/api/')) return handleApi(req, res, path, url);
  return handleStatic(req, res, path);
}).listen(PORT, () => console.log(`Mökki-Canasta: http://localhost:${PORT}`));
