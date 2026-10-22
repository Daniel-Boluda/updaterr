// Režimy hledání ('mode'): 'full' = sloučení stop i výměna celých souborů (výchozí),
// 'audio' = jen přidávání zvukových stop do stávajících souborů – video se nikdy nesměňuje
// a žádný kandidát nemůže přijít o jazyk, který nastavení nesleduje (třeba španělštinu
// v knihovně ESP+ENG, kde se sleduje FR+EN).
const test = require('node:test');
const assert = require('node:assert');
const { arrange } = require('../src/search');
const { autoAllowed } = require('../src/watch');
const { DEFAULT_SETTINGS } = require('../src/store');

const mkStore = (extra = {}) => ({
  settings: { ...DEFAULT_SETTINGS, ...extra },
  s: { items: {}, watchSeries: {}, wantLangs: {} },
  save() {},
});
const item = { key: 'radarr:1', current: { tier: 1, res: 1080 } };

const merge = { kind: 'merge', tier: 3, confidence: 'sure', seeders: 20 };
const replacement = { kind: 'download', tier: 3, confidence: 'sure', seeders: 20, res: 1080 };
const codec = { kind: 'codec', tier: 1, confidence: 'sure', seeders: 20, res: 1080 };

test('výchozí mode je full (zpětná kompatibilita upstream)', () => {
  assert.strictEqual(DEFAULT_SETTINGS.mode, 'full');
});

test('arrange: režim audio nabízí jen sloučení stop, i když by náhrada vyhrála', () => {
  const main = [replacement, codec];
  assert.deepStrictEqual(arrange(main, [merge], 'audio'), [merge]);
});

test('arrange: režim audio bez sloučení = žádný návrh (nic se nestahuje)', () => {
  assert.deepStrictEqual(arrange([replacement], [], 'audio'), []);
});

test('arrange: režim full zachovává pořadí upstreamu – náhrada cíle (tier 3, stejné rozlišení) napřed', () => {
  const top = arrange([replacement], [merge], 'full');
  assert.deepStrictEqual(top, [replacement, merge]);
});

test('arrange: režim full – sloučení napřed, když náhrada cíl nesplní', () => {
  const weaker = { ...replacement, tier: 1 };
  const top = arrange([weaker], [merge], 'full');
  assert.deepStrictEqual(top, [merge, weaker]);
});

test('arrange: bez režimu (výchozí argument) se chová jako full', () => {
  assert.deepStrictEqual(arrange([replacement], [merge]), [replacement, merge]);
});

test('autoAllowed: režim audio odmítá náhradu i codec bez ptaní, sloučení povoluje', () => {
  const store = mkStore({ autoGrab: 'any', mode: 'audio' });
  assert.strictEqual(autoAllowed(store, item, replacement), false);
  assert.strictEqual(autoAllowed(store, item, codec), false);
  assert.strictEqual(autoAllowed(store, item, merge), true);
});

test('autoAllowed: režim full povoluje náhradu cíle bez ptaní (autoGrab=any)', () => {
  const store = mkStore({ autoGrab: 'any' });
  assert.strictEqual(autoAllowed(store, item, replacement), true);
  assert.strictEqual(autoAllowed(store, item, merge), true);
});

test('autoAllowed: režim audio nijak nemění podmínky pro sloučení (jistota, seedeři)', () => {
  const store = mkStore({ autoGrab: 'target', mode: 'audio' });
  assert.strictEqual(autoAllowed(store, item, { ...merge, confidence: 'guess' }), false);
  assert.strictEqual(autoAllowed(store, item, { ...merge, seeders: 2 }), false);
});
