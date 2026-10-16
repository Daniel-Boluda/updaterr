// Hlídání vybraných položek: kontrolují se častěji (watchIntervalDays) a nalezený upgrade se stáhne sám.
// U seriálu se hlídání nastavuje pro celý seriál (platí i pro série, které teprve přibudou).
const L = require('./lang');
const C = require('./codec');

function watchOf(store, item) {
  if (!item) return null;
  if (item.watch) return item.watch;
  if (item.app === 'sonarr') return store.s.watchSeries?.[item.arrId] || null;
  return null;
}

function setWatch(store, item, { enabled, auto = true, series = item.app === 'sonarr', origin }) {
  const w = enabled ? { auto: Boolean(auto), since: new Date().toISOString(), ...(origin ? { origin } : {}) } : null;
  if (item.app === 'sonarr' && series) {
    store.s.watchSeries ??= {};
    if (w) store.s.watchSeries[item.arrId] = w;
    else delete store.s.watchSeries[item.arrId];
    for (const it of Object.values(store.s.items)) {
      if (it.app === 'sonarr' && it.arrId === item.arrId) {
        delete it.watch;
        if (w) { it.ignoredUntil = null; it.lastSearchedAt = null; }
      }
    }
  } else {
    if (w) { item.watch = w; item.ignoredUntil = null; item.lastSearchedAt = null; }
    else delete item.watch;
  }
  store.save();
}

// Nové tituly (settings.autoWatchNew): film nebo seriál, který se v knihovně objevil poprvé (první stažený
// soubor), začne hlídat sám – např. se stáhl jen v EN, ale dál se hledá upgrade na všechny hledané jazyky.
// prevKeys = klíče položek před načtením knihovny. Bez předchozích položek dané aplikace (první načtení,
// dřív nedostupný Radarr/Sonarr) se nehlídá nic, ať se nezapne hlídání celé knihovny. U seriálu jen nový
// seriál (žádná jeho série dřív v knihovně), nová série už známého seriálu ne.
function autoWatchNew(store, app, prevKeys, seen) {
  const mode = store.settings.autoWatchNew;
  if (!['auto', 'ask'].includes(mode)) return [];
  const prevOfApp = [...prevKeys].filter((k) => k.startsWith(app + ':'));
  if (!prevOfApp.length) return [];
  const knownSeries = new Set(prevOfApp.map((k) => k.split(':')[1]));
  const watched = [];
  for (const key of seen) {
    if (prevKeys.has(key)) continue;
    const it = store.s.items[key];
    if (!it || watchOf(store, it)) continue;
    if (app === 'sonarr' && knownSeries.has(String(it.arrId))) continue;
    setWatch(store, it, { enabled: true, auto: mode === 'auto', origin: 'new' });
    watched.push(it);
  }
  return watched;
}

// Hledané jazyky (null = výchozí CZ i EN). U seriálu pro celý seriál, i pro série, které teprve přibudou.
const wantKey = (item) => (item.app === 'sonarr' ? `sonarr:${item.arrId}` : item.key);
function wantOf(store, item) {
  return (item && store.s?.wantLangs?.[wantKey(item)]) || null;
}

function setWant(store, item, langs) {
  const want = L.normWant(langs);
  store.s.wantLangs ??= {};
  if (want) store.s.wantLangs[wantKey(item)] = want;
  else delete store.s.wantLangs[wantKey(item)];
  store.save();
  return want;
}

// Hledaný formát videa (null = neřešit, 'hevc' | 'av1'). Platí stejně jako hledané jazyky.
function codecOf(store, item) {
  return (item && store.s?.wantCodec?.[wantKey(item)]) || null;
}

function setCodec(store, item, codec) {
  const want = C.normWantCodec(codec);
  store.s.wantCodec ??= {};
  if (want) store.s.wantCodec[wantKey(item)] = want;
  else delete store.s.wantCodec[wantKey(item)];
  store.save();
  return want;
}

// Interval opakované kontroly pro položku (ms)
function recheckMs(store, item) {
  const st = store.settings;
  return (watchOf(store, item) ? st.watchIntervalDays : st.recheckDays) * 86400e3;
}

// Smí se nejlepší kandidát stáhnout bez ptaní?
function autoAllowed(store, item, cand) {
  const st = store.settings;
  if (!cand || cand.set) return false;
  const watched = watchOf(store, item)?.auto;
  // Novější formát videa stahuje sám jen hlídaná položka s automatickým upgradem, ne nastavení celé knihovny
  if (cand.kind === 'codec' && !watched) return false;
  const target = L.wantScore(cand.tier, wantOf(store, item), item.origLang) === 3;
  const global = (st.autoGrab === 'target' && target) || st.autoGrab === 'any';
  if (!watched && !global) return false;
  const minConf = watched ? ['sure', 'likely'] : ['sure'];
  if (!minConf.includes(cand.confidence)) return false;
  if (cand.seeders != null && cand.seeders < st.autoMinSeeders) return false;
  // Horší rozlišení kvůli jazyku jen po schválení – kromě slučování, kde video zůstává
  if (cand.kind !== 'merge' && require('./search').lowerRes(cand)) return false;
  return true;
}

module.exports = { watchOf, setWatch, autoWatchNew, wantOf, setWant, codecOf, setCodec, recheckMs, autoAllowed };
