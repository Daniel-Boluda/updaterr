const test = require('node:test');
const assert = require('node:assert');
require('../src/i18n').setLocale('cs'); // testy ověřují české texty
const C = require('../src/codec');
const W = require('../src/watch');
const { evaluateReleases, itemNeeds, combineCurrent } = require('../src/search');
const { fileState } = require('../src/library');
const { DEFAULT_SETTINGS } = require('../src/store');

test('kodek z MediaInfo a z názvu releasu', () => {
  assert.deepStrictEqual(['x264', 'h264', 'AVC', 'x265', 'h265', 'HEVC', 'VP9', 'AV1', 'XviD', 'DivX', '', null].map(C.rankOfCodec),
    [1, 1, 1, 2, 2, 2, 2, 3, 0, 0, null, null]);
  assert.strictEqual(C.nameOf(0, 'XviD'), 'XviD');
  assert.strictEqual(C.nameOf(2, 'VP9'), 'VP9');
  assert.strictEqual(C.nameOf(2, 'x265'), 'H.265');
  const t = (x) => C.codecOfTitle(x);
  assert.strictEqual(t('Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.265-FLUX'), 2);
  assert.strictEqual(t('Dune Part Two 2024 1080p BluRay x265 10bit CZ EN'), 2);
  assert.strictEqual(t('Dune.Part.Two.2024.1080p.WEBRip.HEVC-PSA'), 2);
  assert.strictEqual(t('Dune.Part.Two.2024.1080p.AV1.Opus-GRP'), 3);
  assert.strictEqual(t('Dune.Part.Two.2024.1080p.BluRay.x264-SPARKS'), 1);
  assert.strictEqual(t('Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.H.264-FLUX'), 1);
  assert.strictEqual(t('Duna: Část druhá (2024)[1080p][CZ/EN]'), null, 'bez zmínky = neznámý');
  assert.strictEqual(t('Something.Avatar.1080p'), null, 'ne "av" uvnitř slova');
  assert.strictEqual(t('Show.S01.DVDRip.XviD'), 0);
});

test('stav souboru a série obsahuje kodek', () => {
  const f = (codec) => ({ id: 1, mediaInfo: { audioLanguages: 'cze/eng', videoCodec: codec }, quality: { quality: { name: 'Bluray-1080p', resolution: 1080, source: 'bluray' } } });
  assert.strictEqual(fileState(f('x264'), 'en').vcodec, 1);
  assert.strictEqual(fileState(f(undefined), 'en').vcodec, null);
  const merged = combineCurrent([{ current: { ...fileState(f('x265'), 'en'), tierCounts: [0, 0, 0, 1] } }, { current: { ...fileState(f('h264'), 'en'), tierCounts: [0, 0, 0, 1] } }]);
  assert.strictEqual(merged.vcodec, 1, 'nejhorší série');
  assert.strictEqual(merged.vcodecName, 'H.265 | H.264');
});

const mkCtx = (wantCodec = {}) => ({ store: { settings: { ...DEFAULT_SETTINGS }, s: { ignoredGuids: {}, wantCodec } } });
const movie = (cur = {}) => ({ app: 'radarr', arrId: 7, key: 'radarr:7', origLang: 'en', current: { tier: 3, res: 1080, qrank: 35, audioSource: 'mediainfo', vcodec: 1, vcodecName: 'H.264', ...cur } });
const rel = (guid, title, extra = {}) => ({ guid, indexerId: 1, indexer: 'X', title, seeders: 50, leechers: 0, size: 6e9, protocol: 'torrent', quality: { quality: { name: 'Bluray-1080p', resolution: 1080, source: 'bluray' } }, rejections: [], languages: [], ...extra });

test('hledaný formát: nabídne stejný jazyk v novějším kodeku, ne horší jazyk ani rozlišení', () => {
  const releases = [
    rel('hevc', 'Movie.2020.1080p.BluRay.x265.CZ.EN-GRP'),
    rel('av1', 'Movie.2020.1080p.WEB.AV1.CZ.EN-GRP'),
    rel('h264', 'Movie.2020.1080p.BluRay.x264.CZ.EN-GRP'),
    rel('unknown', 'Movie (2020)[1080p][CZ/EN]'),
    rel('en-only', 'Movie.2020.1080p.BluRay.x265-GRP'),
    rel('720', 'Movie.2020.720p.BluRay.AV1.CZ.EN-GRP', { quality: { quality: { name: 'Bluray-720p', resolution: 720, source: 'bluray' } } }),
  ];
  // bez nastavení se kodek neřeší – soubor CZ + EN 1080p nic nepotřebuje
  assert.deepStrictEqual(evaluateReleases(movie(), releases, mkCtx()).candidates, []);

  const hevc = evaluateReleases(movie(), releases, mkCtx({ 'radarr:7': 'hevc' })).candidates;
  assert.deepStrictEqual(hevc.map((c) => c.guid).sort(), ['av1', 'hevc']);
  assert.ok(hevc.every((c) => c.kind === 'codec'));

  const av1 = evaluateReleases(movie(), releases, mkCtx({ 'radarr:7': 'av1' })).candidates;
  assert.deepStrictEqual(av1.map((c) => c.guid), ['av1']);
  assert.strictEqual(av1[0].vcodecName, 'AV1');

  // soubor už v H.265 → s "H.265 / AV1" nic, s "Jen AV1" AV1
  assert.deepStrictEqual(evaluateReleases(movie({ vcodec: 2 }), releases, mkCtx({ 'radarr:7': 'hevc' })).candidates, []);
  assert.deepStrictEqual(evaluateReleases(movie({ vcodec: 2 }), releases, mkCtx({ 'radarr:7': 'av1' })).candidates.map((c) => c.guid), ['av1']);
  // kodek souboru neznámý → neřešit
  assert.deepStrictEqual(evaluateReleases(movie({ vcodec: null }), releases, mkCtx({ 'radarr:7': 'av1' })).candidates, []);
});

test('hledaný formát: jazykový upgrade dostane varování, když zhorší kodek; řazení napřed hledaný kodek', () => {
  const ctx = mkCtx({ 'radarr:7': 'hevc' });
  const item = movie({ tier: 1, vcodec: 2, vcodecName: 'H.265' });
  const out = evaluateReleases(item, [
    rel('cz264', 'Movie.2020.1080p.BluRay.x264.CZ.EN-GRP', { seeders: 400 }),
    rel('cz265', 'Movie.2020.1080p.BluRay.x265.CZ.EN-GRP', { seeders: 20 }),
  ], ctx).candidates;
  assert.deepStrictEqual(out.map((c) => c.guid), ['cz265', 'cz264']);
  assert.ok(out[1].warnings.some((w) => w.includes('starší formát videa (H.265 → H.264)')));
  assert.strictEqual(out[0].kind, 'language');
});

test('hledaný formát: itemNeeds a automatické stažení', () => {
  assert.strictEqual(itemNeeds(movie(), DEFAULT_SETTINGS, null, null).any, false);
  assert.strictEqual(itemNeeds(movie(), DEFAULT_SETTINGS, null, 'hevc').codec, true);
  assert.strictEqual(itemNeeds(movie({ vcodec: 2 }), DEFAULT_SETTINGS, null, 'hevc').codec, false);
  assert.strictEqual(itemNeeds(movie({ vcodec: null }), DEFAULT_SETTINGS, null, 'av1').codec, false);

  const cand = { kind: 'codec', tier: 3, confidence: 'sure', seeders: 50, warnings: [] };
  const store = (s) => ({ settings: { ...DEFAULT_SETTINGS, autoGrab: 'any' }, s });
  assert.strictEqual(W.autoAllowed(store({}), movie(), cand), false, 'celá knihovna novější formát sama nestahuje');
  assert.strictEqual(W.autoAllowed(store({}), { ...movie(), watch: { auto: true } }, cand), true);
});

test('nastavení formátu u seriálu platí pro celý seriál', () => {
  const store = { s: {}, save() {} };
  const s1 = { app: 'sonarr', arrId: 5, season: 1, key: 'sonarr:5:1' };
  assert.strictEqual(W.setCodec(store, s1, 'av1'), 'av1');
  assert.strictEqual(W.codecOf(store, { ...s1, season: 3, key: 'sonarr:5:3' }), 'av1');
  assert.strictEqual(W.setCodec(store, s1, 'mp4'), null, 'neznámá hodnota = neřešit');
  assert.strictEqual(W.codecOf(store, s1), null);
});
