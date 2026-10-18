const test = require('node:test');
const assert = require('node:assert');
const { plan } = require('../src/cleanup');

const tor = (hash) => ({ hash: hash.toLowerCase() });

test('hotové stahování: smaže torrenty, které v qBittorrentu jsou (hash bez ohledu na velikost písmen)', () => {
  const d = { state: 'done', parts: [{ downloadId: 'AA' }, { downloadId: 'BB' }, { downloadId: 'CC' }] };
  const out = plan([d], [tor('aa'), tor('cc'), tor('zz')], new Set());
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].hashes, ['aa', 'cc']);
});

test('nehotová, už uklizená a jiná stahování se nechají být', () => {
  const list = [
    { state: 'downloading', active: true, parts: [{ downloadId: 'AA' }] },
    { state: 'failed', parts: [{ downloadId: 'BB' }] },
    { state: 'done', torrentsRemoved: 1, parts: [{ downloadId: 'CC' }] },
  ];
  assert.deepStrictEqual(plan(list, [tor('aa'), tor('bb'), tor('cc')], new Set()), []);
});

test('torrent používaný běžící úlohou se nesmaže', () => {
  const d = { state: 'done', parts: [{ downloadId: 'AA' }] };
  assert.deepStrictEqual(plan([d], [tor('aa')], new Set(['aa'])), []);
});

test('starý záznam bez parts a záznam, jehož torrent už zmizel', () => {
  const old = { state: 'done', downloadId: 'AA' };
  const gone = { state: 'done', parts: [{ downloadId: 'BB' }, { downloadId: null }] };
  const out = plan([old, gone], [tor('aa')], new Set());
  assert.deepStrictEqual(out.map((x) => x.hashes), [['aa'], []]);
});
