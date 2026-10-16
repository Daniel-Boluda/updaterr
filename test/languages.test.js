const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/lang');
const LANGS = require('../src/languages');
const { reconcile } = require('../src/speech');
const { migrate } = require('../src/store');

const tier = (title, origLang = 'en') => L.tierOf(L.evaluateRelease(title, { origLang }), origLang);

test('tabulka jazyků – značky stop a názvy z Radarru', () => {
  assert.strictEqual(LANGS.fromTag('cze'), 'cs');
  assert.strictEqual(LANGS.fromTag('ger'), 'de');
  assert.strictEqual(LANGS.fromTag('pt-BR'), 'pt');
  assert.strictEqual(LANGS.fromTag('und'), null);
  assert.strictEqual(LANGS.fromTag('xyz'), 'other');
  assert.strictEqual(LANGS.fromArrName('Portuguese (Brazil)'), 'pt');
  assert.strictEqual(LANGS.tagOf('de'), 'ger');
  assert.strictEqual(LANGS.flagOf('cs'), '🇨🇿');
});

test('němčina + angličtina', () => {
  L.configure({ primary: 'de', secondary: 'en' });
  try {
    assert.strictEqual(tier('Dune.2021.German.DL.1080p.BluRay.x264-GROUP'), 3, 'DL = dabing + originál');
    assert.strictEqual(tier('Dune.2021.German.1080p.WEB-DL'), 2);
    assert.strictEqual(tier('Dune.2021.1080p.WEB-DL.DDP5.1'), 1, 'WEB-DL není "DL"');
    assert.strictEqual(tier('Das.Boot.1981.1080p.BluRay', 'de'), 3, 'německý originál');
    assert.strictEqual(L.tierLabel(3), 'DE + EN');
    assert.deepStrictEqual(L.audioFromMediaInfo('ger/eng'), { pri: true, sec: true, langs: ['de', 'en'], known: true, raw: 'ger/eng' });
  } finally {
    L.configure({ primary: 'cs', secondary: 'en' });
  }
});

test('francouzština – VOSTFR jsou titulky', () => {
  L.configure({ primary: 'fr', secondary: 'en' });
  try {
    assert.strictEqual(tier('Dune.2021.MULTi.TRUEFRENCH.1080p.BluRay'), 3);
    assert.strictEqual(tier('Dune.2021.VOSTFR.1080p.WEB'), 1, 'VOSTFR = originál s francouzskými titulky');
    assert.strictEqual(tier('Dune.2021.VFF.1080p.WEB'), 2);
  } finally {
    L.configure({ primary: 'cs', secondary: 'en' });
  }
});

test('polština – lektor je zvuk, napisy titulky', () => {
  L.configure({ primary: 'pl', secondary: 'en' });
  try {
    assert.strictEqual(tier('Diuna.2021.PL.Lektor.1080p.WEB-DL'), 2);
    assert.strictEqual(tier('Diuna.2021.PL.Napisy.1080p.WEB-DL'), 1, 'titulky → originální zvuk');
    assert.strictEqual(tier('Diuna 2021 PLDUB ENG 1080p'), 3);
  } finally {
    L.configure({ primary: 'cs', secondary: 'en' });
  }
});

test('reconcile – blízké jazyky se Whisperu pletou', () => {
  const sure = (lang) => ({ lang, confidence: 0.9, agree: 3, samples: 3 });
  assert.deepStrictEqual(reconcile('hr', sure('sr')), { lang: 'hr', corrected: false });
  assert.deepStrictEqual(reconcile('sr', sure('hr'), 'hr'), { lang: 'hr', corrected: true });
  assert.deepStrictEqual(reconcile('en', sure('de')), { lang: 'de', corrected: true });
});

test('migrace stavu z verze jen pro CZ + EN', () => {
  const st = {
    settings: { czIndexers: 'sktorrent', mergeCzDefault: false },
    items: { 'radarr:1': { origLang: 'cz', langCheck: { files: [{ tracks: [{ tag: 'en', used: 'cz' }] }] } } },
    proposals: { p: { candidates: [{ cz: true, en: false, kind: 'merge', mergeLang: 'cz' }] } },
    merges: { m: { need: 'cz', candidate: { cz: true, en: true } } },
    wantLangs: { 'radarr:1': ['cz'], 'sonarr:2': ['en'] },
  };
  migrate(st);
  assert.deepStrictEqual(st.settings, { language: 'cs', secondLanguage: 'en', localIndexers: 'sktorrent', mergePrimaryDefault: false });
  assert.strictEqual(st.items['radarr:1'].origLang, 'cs');
  assert.deepStrictEqual(st.items['radarr:1'].langCheck.files[0].tracks[0], { tag: 'en', used: 'cs' });
  assert.deepStrictEqual(st.proposals.p.candidates[0], { pri: true, sec: false, kind: 'merge', mergeLang: 'cs' });
  assert.deepStrictEqual(st.merges.m, { need: 'cs', candidate: { pri: true, sec: true } });
  assert.deepStrictEqual(st.wantLangs, { 'radarr:1': ['pri'], 'sonarr:2': ['sec'] });
  // nový stav (bez starých klíčů) se nemění
  const fresh = { settings: { language: 'de' } };
  migrate(fresh);
  assert.deepStrictEqual(fresh, { settings: { language: 'de' } });
});
