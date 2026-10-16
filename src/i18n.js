// Překlady textů ze serveru (log, notifikace, chybové hlášky). Slovníky jsou v src/locales/<jazyk>.json,
// klíče jsou ploché ("search.nothingBetter"). Chybějící klíč se vezme z angličtiny, pak se vrátí klíč samotný.
//
//   t('key', { name: 'X' })        → "… X …"   ({name} v textu)
//   t('key', { count: 3 })         → plurál podle Intl.PluralRules: hodnota je objekt { one, few, many, other }
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'locales');
const DICT = {};
for (const f of fs.readdirSync(DIR)) {
  if (f.endsWith('.json')) DICT[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
}
const LOCALES = Object.keys(DICT).sort();

let current = 'en';

// 'auto' → jazyk textů podle hledaného jazyka dabingu (když pro něj je překlad), jinak angličtina
function resolveLocale(uiLanguage, primary) {
  if (uiLanguage && uiLanguage !== 'auto' && DICT[uiLanguage]) return uiLanguage;
  return DICT[primary] ? primary : 'en';
}

function setLocale(l) { current = DICT[l] ? l : 'en'; }
const locale = () => current;

function format(s, params) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? params[k] : m));
}

function t(key, params = {}, loc = current) {
  let s = DICT[loc]?.[key] ?? DICT.en?.[key];
  if (s === undefined) return key;
  if (typeof s === 'object') {
    const n = Number(params.count ?? 0);
    s = s[new Intl.PluralRules(loc).select(n)] ?? s.other ?? Object.values(s)[0];
  }
  return format(s, params);
}

// Název jazyka v jazyce textů ("cs" → "čeština" / "Czech")
function langName(code, loc = current) {
  try { return new Intl.DisplayNames([loc], { type: 'language' }).of(code) || code; } catch { return code; }
}

const fmtDate = (d, loc = current) => new Date(d).toLocaleDateString(loc);
const fmtDateTime = (d, loc = current) => new Date(d).toLocaleString(loc);

module.exports = { t, setLocale, locale, resolveLocale, langName, fmtDate, fmtDateTime, LOCALES };
