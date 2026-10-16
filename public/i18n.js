'use strict';
/* Překlady UI. Načte jazyk textů (podle serveru) a slovník dřív, než se spustí app.js – texty v app.js tak
   můžou volat t() už při načtení. Slovníky: locales/<jazyk>.json, ploché klíče; chybějící klíč se vezme
   z angličtiny. Plurál: hodnota je objekt { one, few, many, other } a do parametrů patří { count }. */
const I18N = { locale: 'en', dict: {}, en: {}, boot: null };

function t(key, params = {}) {
  let s = I18N.dict[key] ?? I18N.en[key];
  if (s === undefined) return key;
  if (typeof s === 'object') {
    const n = Number(params.count ?? 0);
    s = s[new Intl.PluralRules(I18N.locale).select(n)] ?? s.other ?? Object.values(s)[0];
  }
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? params[k] : m));
}

// Název jazyka v jazyce UI ("de" → "němčina" / "German")
function langName(code) {
  try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch { return code; }
}

(async () => {
  try {
    const res = await fetch('api/overview');
    if (res.ok) {
      I18N.boot = await res.json();
      I18N.locale = I18N.boot.locale || 'en';
    }
  } catch { /* server nedostupný – app.js to ukáže */ }
  const get = (l) => fetch(`locales/${l}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [en, dict] = await Promise.all([get('en'), I18N.locale === 'en' ? null : get(I18N.locale)]);
  I18N.en = en;
  I18N.dict = dict || en;
  document.documentElement.lang = I18N.locale;
  // app.js a po něm notifications.js (používá jeho funkce a stav); async=false drží pořadí spuštění
  for (const src of ['app.js', 'notifications.js']) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.append(s);
  }
})();
