import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimaalinen DOM-simulaatio jotta app.js voidaan ladata ja ajaa ilman selainta.
class FakeEl {
  constructor(id = '_') {
    this.id = id; this.children = []; this.style = {}; this.dataset = {};
    this._html = ''; this._text = ''; this._listeners = {};
    this.checked = false;
    this.classList = {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    };
  }
  set innerHTML(v) { this._html = v; if (v === '') this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set className(v) { this._cn = v; }
  get className() { return this._cn; }
  set onclick(fn) { this._onclick = fn; }
  get onclick() { return this._onclick; }
  set onchange(fn) { this._onchange = fn; }
  get onchange() { return this._onchange; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  closest() { return this; }
  querySelector() { return null; }
}

function installDom() {
  const els = new Map();
  global.document = {
    getElementById(id) { if (!els.has(id)) els.set(id, new FakeEl(id)); return els.get(id); },
    createElement() { return new FakeEl(); },
    _body: new FakeEl('body'),
    get body() { return this._body; },
  };
  return els;
}

function findButton(container, label) {
  return container.children.find((b) => b.textContent === label);
}

test('käyttöliittymä latautuu, peli alkaa ja nosto toimii ilman virhettä', async () => {
  installDom();
  // Ladataan sovellus (rekisteröi käsittelijät).
  await import('../web/app.js');

  // Aloita peli (oletus: 3 pelaajaa, ihminen + 2 bottia).
  const startBtn = document.getElementById('startBtn');
  assert.equal(typeof startBtn.onclick, 'function');
  startBtn.onclick();

  // Pelinäkymä näkyy, vuoro on ihmisellä.
  assert.equal(document.getElementById('game').style.display, 'flex');
  assert.match(document.getElementById('turnInfo').textContent, /vuorosi/i);

  // Draw-vaiheessa pitää olla "Nosta pakasta" -nappi.
  const actions = document.getElementById('actions');
  const drawBtn = findButton(actions, 'Nosta pakasta');
  assert.ok(drawBtn, 'nostonappi puuttuu');

  // Nosta kortti -> siirrytään toimintavaiheeseen (heittonappi ilmestyy).
  drawBtn.onclick();
  const discardBtn = findButton(document.getElementById('actions'), 'Heitä valittu');
  assert.ok(discardBtn, 'heittonappi puuttuu noston jälkeen');

  // Käsi renderöityi kortteina.
  assert.ok(document.getElementById('hand').children.length >= 13);
});
