// Build: kopioi selaimen tiedostot public/-kansioon (Vercel tarjoilee public/:n sellaisenaan).
// API-funktiot (/api) käyttävät edelleen repo-juuren /src:iä palvelinpuolella.
import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

rmSync('public', { recursive: true, force: true });
mkdirSync('public/src', { recursive: true });

// index.html: viittaa /app.js:aan (public-juuresta).
const html = readFileSync('web/index.html', 'utf8').replace('/web/app.js', '/app.js');
writeFileSync('public/index.html', html);

// app.js selaimeen; sen importit ../src/* osuvat public/src/*:aan.
copyFileSync('web/app.js', 'public/app.js');

// Vain selaimen tarvitsemat moduulit (ei palvelinkoodia public:iin).
const BROWSER_SRC = ['cards.js', 'melds.js', 'scoring.js', 'game.js', 'bot.js'];
for (const f of BROWSER_SRC) copyFileSync(`src/${f}`, `public/src/${f}`);

console.log('build valmis -> public/ (index.html, app.js, src/*)');
