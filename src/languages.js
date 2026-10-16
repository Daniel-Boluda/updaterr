// Tabulka jazyků: kódy ISO 639-1 (= kódy Whisperu), ISO 639-2 (značky stop v MKV/MediaInfo), názvy, jak je
// používají Radarr/Sonarr, a slova, kterými jazyk zmiňují názvy releasů.
//
//   name    – anglický název jako v Radarru/Sonarru (pole languages[].name, originalLanguage.name)
//   names   – další názvy z Radarru/Sonarru, které se počítají jako tentýž jazyk
//   codes   – značky zvukových stop (ISO 639-2 B/T a další zápisy z MediaInfo)
//   tokens  – slova v názvech releasů (malými písmeny). Schválně bez dvoupísmenných kódů, které jsou běžná
//             slova v názvech filmů ("It", "De", "No"…), a bez trojpísmenných, které jsou anglická slova (cat, ice…).
//   dub/sub – slova, která za/před jazykem znamenají dabing / titulky ("dabing", "napisy", "felirat"…)
//   label   – zkratka pro UI, výchozí je kód velkými písmeny (u češtiny zažité "CZ")
//   indexers – části názvů místních trackerů, ze kterých je release "MULTI" nejspíš i v tomhle jazyce
//   confusable – jazyky, které si Whisper s tímhle plete (pak platí značka stopy)
const LANGUAGES = [
  { code: 'en', name: 'English', codes: ['eng'], tokens: ['en', 'eng', 'english', 'anglicky', 'angličtina'] },
  { code: 'cs', name: 'Czech', label: 'CZ', codes: ['cze', 'ces', 'cz'],
    tokens: ['cz', 'cze', 'ces', 'czech', 'cesky', 'česky', 'cestina', 'čeština', 'cesko', 'czk'],
    dub: ['dab', 'dabing', 'dabingem', 'dabbing', 'zvuk'], sub: ['tit', 'titl', 'titulky', 'titulkami', 'subtitulky'],
    indexers: ['sktorrent', 'trezzor', 'cztorrent', 'czt', 'tracker.cz'], confusable: ['sk'] },
  { code: 'sk', name: 'Slovak', codes: ['slo', 'slk'], tokens: ['sk', 'slo', 'slk', 'svk', 'slovak', 'slovensky', 'slovenský', 'slovencina', 'slovenčina'],
    dub: ['dabing'], sub: ['titulky'], indexers: ['sktorrent'], confusable: ['cs'] },
  { code: 'pl', name: 'Polish', codes: ['pol'], tokens: ['pl', 'pol', 'polish', 'polski'],
    dub: ['lektor', 'dubbing', 'pldub'], sub: ['napisy', 'plsub'] },
  { code: 'de', name: 'German', codes: ['ger', 'deu'], tokens: ['ger', 'deu', 'german', 'deutsch'],
    dub: ['dl', 'synchro'], sub: ['untertitel'] },
  { code: 'fr', name: 'French', codes: ['fre', 'fra'], tokens: ['fre', 'fra', 'french', 'francais', 'français', 'truefrench', 'vf', 'vff', 'vfq', 'vfi', 'vf2'],
    sub: ['vostfr', 'stfr', 'soustitres'], subTokens: ['vostfr', 'stfr'] },
  { code: 'es', name: 'Spanish', names: ['Spanish (Latino)'], codes: ['spa', 'esl'], tokens: ['spa', 'esp', 'spanish', 'espanol', 'español', 'castellano', 'latino'],
    sub: ['subtitulado', 'subtitulos'], dub: ['doblaje', 'doblado'] },
  { code: 'it', name: 'Italian', codes: ['ita'], tokens: ['ita', 'italian', 'italiano'], sub: ['sottotitoli'] },
  { code: 'pt', name: 'Portuguese', names: ['Portuguese (Brazil)', 'Brazilian'], codes: ['por', 'pob'], tokens: ['pt', 'portuguese', 'portugues', 'português', 'ptbr', 'brazilian'],
    dub: ['dublado'], sub: ['legendado', 'legenda', 'legendas'] },
  { code: 'nl', name: 'Dutch', names: ['Flemish'], codes: ['dut', 'nld'], tokens: ['nl', 'dut', 'nld', 'dutch', 'nederlands', 'flemish', 'vlaams'], sub: ['ondertiteld'] },
  { code: 'hu', name: 'Hungarian', codes: ['hun'], tokens: ['hun', 'hungarian', 'magyar'], dub: ['szinkron'], sub: ['felirat', 'feliratos'] },
  { code: 'ro', name: 'Romanian', codes: ['rum', 'ron'], tokens: ['romanian', 'romana', 'română'], sub: ['subtitrat'] },
  { code: 'ru', name: 'Russian', codes: ['rus'], tokens: ['ru', 'rus', 'russian'] },
  { code: 'uk', name: 'Ukrainian', label: 'UA', codes: ['ukr'], tokens: ['ua', 'ukr', 'ukrainian'] },
  { code: 'bg', name: 'Bulgarian', codes: ['bul'], tokens: ['bulgarian'] },
  { code: 'hr', name: 'Croatian', codes: ['hrv', 'scr'], tokens: ['hrv', 'cro', 'croatian', 'hrvatski'], confusable: ['sr', 'bs'] },
  { code: 'sr', name: 'Serbian', codes: ['srp', 'scc'], tokens: ['srp', 'serbian', 'srpski'], confusable: ['hr', 'bs'] },
  { code: 'bs', name: 'Bosnian', codes: ['bos'], tokens: ['bosnian'], confusable: ['hr', 'sr'] },
  { code: 'sl', name: 'Slovenian', codes: ['slv'], tokens: ['slv', 'slovenian', 'slovene', 'slovensko'] },
  { code: 'mk', name: 'Macedonian', codes: ['mac', 'mkd'], tokens: ['mkd', 'macedonian'] },
  { code: 'sq', name: 'Albanian', codes: ['alb', 'sqi'], tokens: ['albanian'] },
  { code: 'el', name: 'Greek', codes: ['gre', 'ell'], tokens: ['gre', 'ell', 'greek'] },
  { code: 'tr', name: 'Turkish', codes: ['tur'], tokens: ['tur', 'turkish', 'turkce', 'türkçe'], dub: ['dublaj'], sub: ['altyazi', 'altyazı'] },
  { code: 'sv', name: 'Swedish', codes: ['swe'], tokens: ['swe', 'swedish', 'svenska'] },
  { code: 'no', name: 'Norwegian', codes: ['nor', 'nob', 'nno'], tokens: ['norwegian', 'norsk'] },
  { code: 'da', name: 'Danish', codes: ['dan'], tokens: ['danish', 'dansk'] },
  { code: 'fi', name: 'Finnish', codes: ['fin'], tokens: ['finnish', 'suomi'] },
  { code: 'is', name: 'Icelandic', codes: ['ice', 'isl'], tokens: ['icelandic'] },
  { code: 'et', name: 'Estonian', codes: ['est'], tokens: ['estonian'] },
  { code: 'lv', name: 'Latvian', codes: ['lav'], tokens: ['lav', 'latvian'] },
  { code: 'lt', name: 'Lithuanian', codes: ['lit'], tokens: ['lithuanian'] },
  { code: 'ca', name: 'Catalan', codes: ['cat'], tokens: ['catalan', 'catala', 'català'] },
  { code: 'he', name: 'Hebrew', codes: ['heb'], tokens: ['heb', 'hebrew'] },
  { code: 'ar', name: 'Arabic', codes: ['ara'], tokens: ['arabic'] },
  { code: 'fa', name: 'Persian', codes: ['per', 'fas'], tokens: ['persian', 'farsi'] },
  { code: 'hi', name: 'Hindi', codes: ['hin'], tokens: ['hin', 'hindi'] },
  { code: 'bn', name: 'Bengali', codes: ['ben'], tokens: ['bengali'] },
  { code: 'ta', name: 'Tamil', codes: ['tam'], tokens: ['tamil'] },
  { code: 'te', name: 'Telugu', codes: ['tel'], tokens: ['telugu'] },
  { code: 'ml', name: 'Malayalam', codes: ['mal'], tokens: ['malayalam'] },
  { code: 'kn', name: 'Kannada', codes: ['kan'], tokens: ['kannada'] },
  { code: 'th', name: 'Thai', codes: ['tha'], tokens: ['thai'] },
  { code: 'vi', name: 'Vietnamese', codes: ['vie'], tokens: ['vietnamese'] },
  { code: 'id', name: 'Indonesian', codes: ['ind'], tokens: ['indonesian', 'indo'], confusable: ['ms'] },
  { code: 'ms', name: 'Malay', codes: ['may', 'msa'], tokens: ['malay'], confusable: ['id'] },
  { code: 'tl', name: 'Tagalog', names: ['Filipino'], codes: ['tgl', 'fil'], tokens: ['tagalog', 'filipino'] },
  { code: 'ja', name: 'Japanese', codes: ['jpn'], tokens: ['jpn', 'jap', 'japanese'] },
  { code: 'ko', name: 'Korean', codes: ['kor'], tokens: ['kor', 'korean'] },
  { code: 'zh', name: 'Chinese', names: ['Mandarin', 'Cantonese'], codes: ['chi', 'zho', 'cmn', 'yue'], tokens: ['chi', 'chinese', 'mandarin', 'cantonese'] },
];

// Země pro vlajku v notifikacích (emoji z regionálních písmen), kde se neshoduje s kódem jazyka
const COUNTRY = { en: 'GB', cs: 'CZ', uk: 'UA', el: 'GR', he: 'IL', ar: 'SA', fa: 'IR', hi: 'IN', bn: 'BD', ta: 'IN', te: 'IN',
  ml: 'IN', kn: 'IN', ja: 'JP', ko: 'KR', zh: 'CN', sv: 'SE', da: 'DK', et: 'EE', ca: 'ES', sq: 'AL', sl: 'SI', sr: 'RS',
  bs: 'BA', vi: 'VN', ms: 'MY', tl: 'PH', nb: 'NO' };

const BY_CODE = new Map();
const BY_TAG = new Map();      // značka stopy / název → kód
const BY_TOKEN = new Map();    // slovo v názvu releasu → kód
for (const l of LANGUAGES) {
  l.label ??= l.code.toUpperCase();
  l.country = COUNTRY[l.code] || l.code.toUpperCase();
  l.names = [l.name, ...(l.names || [])];
  l.dub ??= [];
  l.sub ??= [];
  l.subTokens ??= [];
  l.indexers ??= [];
  l.confusable ??= [];
  BY_CODE.set(l.code, l);
  for (const t of [l.code, ...l.codes, ...l.names.map((n) => n.toLowerCase())]) BY_TAG.set(t, l.code);
  for (const t of l.tokens) if (!BY_TOKEN.has(t)) BY_TOKEN.set(t, l.code);
}

const get = (code) => BY_CODE.get(code) || null;

// Značka stopy ("cze", "eng", "Czech", "pt-BR") → kód ISO 639-1; neznámé → 'other'; "und" a prázdné → null
function fromTag(tag) {
  const c = String(tag || '').trim().toLowerCase();
  if (!c || ['und', 'unknown', 'mis', 'zxx', 'mul', 'qaa'].includes(c)) return null;
  return BY_TAG.get(c) || BY_TAG.get(c.split(/[-_]/)[0]) || 'other';
}

// Jazyk z Radarru/Sonarru ({ name: 'Czech' }) → kód; neznámé → 'other'
function fromArrName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || n === 'unknown' || n === 'any' || n === 'original') return null;
  return BY_TAG.get(n) || 'other';
}

// Slovo z názvu releasu → kód, nebo null
const fromToken = (tok) => BY_TOKEN.get(tok) || null;

// Vlajka jako emoji (🇨🇿) – z kódu země
const flagOf = (code) => {
  const c = get(code)?.country;
  return c ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';
};

// ISO 639-2/B pro značku stopy v MKV (mkvmerge --language)
const tagOf = (code) => get(code)?.codes[0] || code;

module.exports = { LANGUAGES, get, fromTag, fromArrName, fromToken, tagOf, flagOf };
