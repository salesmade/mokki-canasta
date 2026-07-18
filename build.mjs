// Build: bundlaa KAIKKI itsenäisiksi tiedostoiksi esbuildilla.
// Lopputuloksessa ei yhtään ../src-importtia -> Vercelillä ei voi tulla "Cannot find module".
//   web/app.js        -> public/app.js   (selain, self-contained)
//   functions/*.js    -> api/*.js         (serverless-funktiot, self-contained)
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

// --- Selain ---
rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });
await build({
  entryPoints: ['web/app.js'],
  outfile: 'public/app.js',
  bundle: true,
  format: 'esm',
  target: 'es2020',
});
// index.html viittaa /app.js:aan
writeFileSync('public/index.html', readFileSync('web/index.html', 'utf8').replace('/web/app.js', '/app.js'));

// --- Serverless-funktiot ---
rmSync('api', { recursive: true, force: true });
mkdirSync('api', { recursive: true });
const FUNCTIONS = ['create', 'join', 'start', 'move', 'next', 'state', 'ping'];
for (const name of FUNCTIONS) {
  await build({
    entryPoints: [`functions/${name}.js`],
    outfile: `api/${name}.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
  });
}

console.log('build valmis: public/ (index.html, app.js) + api/ (' + FUNCTIONS.join(', ') + ')');
