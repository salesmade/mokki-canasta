// Build: bundlaa kaiken itsenäisiksi tiedostoiksi. Staattiset JUUREEN, funktiot api/:iin.
//   web/app.js     -> app.js        (juuri, selain, self-contained, @vercel/static)
//   web/index.html -> index.html    (juuri)
//   functions/*.js -> api/*.js       (CommonJS, self-contained, @vercel/node)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

// --- Selain juureen (staattinen) ---
await build({
  entryPoints: ['web/app.js'],
  outfile: 'app.js',
  bundle: true,
  format: 'esm',
  target: 'es2020',
});
writeFileSync('index.html', readFileSync('web/index.html', 'utf8').replace('/web/app.js', '/app.js'));

// --- Funktiot api/:iin (CommonJS) ---
rmSync('api', { recursive: true, force: true });
mkdirSync('api', { recursive: true });
writeFileSync('api/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
const FUNCTIONS = ['create', 'join', 'start', 'move', 'next', 'state', 'ping'];
for (const name of FUNCTIONS) {
  await build({
    entryPoints: [`functions/${name}.js`],
    outfile: `api/${name}.js`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });
}

// Vanha public/ pois
rmSync('public', { recursive: true, force: true });
console.log('build valmis: index.html + app.js (juuri) + api/ (' + FUNCTIONS.join(', ') + ')');
