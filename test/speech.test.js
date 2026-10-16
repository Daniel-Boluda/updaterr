const test = require('node:test');
const assert = require('node:assert');
require('../src/i18n').setLocale('cs'); // testy ověřují české texty
const { parseWhisper, vote, reconcile } = require('../src/speech');
const { applyLangCheck, prune } = require('../src/langcheck');
const { DEFAULT_SETTINGS } = require('../src/store');

test('parseWhisper – jazyk a délka řeči', () => {
  assert.deepStrictEqual(
    parseWhisper('vad: total duration of speech segments: 26.30 seconds\nwhisper_full_with_state: auto-detected language: de (p = 0.981904)'),
    { lang: 'de', p: 0.981904, speechSec: 26.3 });
  assert.strictEqual(parseWhisper('vad_segments_from_probs: Final speech segments after filtering: 0\n').speechSec, 0);
});

test('vote – úseky bez řeči se nepočítají', () => {
  const v = vote([
    { lang: 'en', p: 0.9, speechSec: 0 },        // vzdechy → "en", ignorovat
    { lang: 'de', p: 0.98, speechSec: 26 },
    { lang: 'de', p: 0.97, speechSec: 22 },
    { lang: 'en', p: 0.55, speechSec: 5 },
  ]);
  assert.strictEqual(v.lang, 'de');
  assert.strictEqual(v.agree, 2);
  assert.strictEqual(v.samples, 3);
});

test('reconcile – kdy věřit poslechu', () => {
  const sure = (lang) => ({ lang, confidence: 0.9, agree: 3, samples: 4 });
  // YouTube webm: česká stopa označená jako eng
  assert.deepStrictEqual(reconcile('en', sure('cs')), { lang: 'cs', corrected: true });
  // značka sedí
  assert.deepStrictEqual(reconcile('cs', sure('cs')), { lang: 'cs', corrected: false });
  // čeština × slovenština – Whisper se plete, platí značka
  assert.deepStrictEqual(reconcile('sk', sure('cs')), { lang: 'sk', corrected: false });
  assert.deepStrictEqual(reconcile('sk', sure('cs'), 'en'), { lang: 'sk', corrected: false });
  // český film se stopou "slo" a českou řečí (slovenští herci) → čeština
  assert.deepStrictEqual(reconcile('sk', sure('cs'), 'cs'), { lang: 'cs', corrected: true });
  // značka "cze" u českého filmu zůstává, i když Whisper slyší slovenštinu
  assert.deepStrictEqual(reconcile('cs', sure('sk'), 'cs'), { lang: 'cs', corrected: false });
  // nejisté → pořád značka
  assert.deepStrictEqual(reconcile('sk', { lang: 'cs', confidence: 0.9, agree: 1, samples: 1 }, 'cs'), { lang: 'sk', corrected: false });
  // bez značky → podle poslechu
  assert.deepStrictEqual(reconcile(null, sure('en')), { lang: 'en', corrected: true });
  // nejisté (jen jeden úsek s řečí) → značka
  assert.deepStrictEqual(reconcile('en', { lang: 'cs', confidence: 1, agree: 1, samples: 1 }), { lang: 'en', corrected: false });
  // bez řeči → značka
  assert.deepStrictEqual(reconcile('en', { lang: null, confidence: 0, samples: 0 }), { lang: 'en', corrected: false });
});

test('applyLangCheck – oprava platí jen pro ověřené soubory', () => {
  const lc = { fileIds: [7], corrected: true, tier: 3, audio: 'cze' };
  const item = { origLang: 'cs', langCheck: lc, current: { tier: 1, audio: 'eng', fileIds: [7], audioSource: 'mediainfo' } };
  applyLangCheck(item);
  assert.strictEqual(item.current.tier, 3);
  assert.strictEqual(item.current.audioSource, 'poslech');
  assert.strictEqual(item.current.tagAudio, 'eng');

  const replaced = { langCheck: lc, current: { tier: 1, audio: 'eng', fileIds: [8] } };
  applyLangCheck(replaced);
  assert.strictEqual(replaced.current.tier, 1);
  assert.strictEqual(replaced.langCheck, undefined, 'nový soubor → staré ověření pryč');
});

test('prune – po ověření zmizí kandidáti, kteří už nejsou lepší', () => {
  const ctx = { store: { settings: { ...DEFAULT_SETTINGS } } };
  const item = { origLang: 'cs', current: { tier: 3, res: 1080, audio: 'cze' } };
  const p = { status: 'pending', candidates: [{ kind: 'language', tier: 3, res: 1080 }, { kind: 'merge', mergeLang: 'cs', tier: 3 }] };
  prune(ctx, p, item);
  assert.strictEqual(p.status, 'expired');
  assert.match(p.note, /Ověřeno poslechem/);

  const item2 = { origLang: 'en', current: { tier: 2, res: 1080, audio: 'cze' } };
  const p2 = { status: 'pending', candidates: [{ kind: 'language', tier: 3, res: 1080 }, { kind: 'language', tier: 2, res: 720 }, { kind: 'merge', mergeLang: 'cs', tier: 3 }] };
  prune(ctx, p2, item2);
  assert.strictEqual(p2.status, 'pending');
  assert.deepStrictEqual(p2.candidates.map((c) => c.tier), [3]);
});
