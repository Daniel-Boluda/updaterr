// Ověření jazyka "poslechem": porovná značky zvukových stop s rozpoznanou řečí a výsledek uloží k položce
// (item.langCheck). Platí jen pro soubory, na kterých se ověřovalo – po výměně souboru se zahodí.
const L = require('./lang');
const S = require('./speech');
const A = require('./audio');

const sameIds = (a, b) => JSON.stringify([...(a || [])].sort((x, y) => x - y)) === JSON.stringify([...(b || [])].sort((x, y) => x - y));
const LANGS = require('./languages');
const I18N = require('./i18n');

// Jazyk → značka stopy pro log a UI ("cs" → "cze")
const tagOut = (l) => (l === 'other' ? '?' : LANGS.tagOf(l));
const tierText = (tier, item) => L.tierText(tier, item.origLang);

// Ověření zapnuté a k dispozici, a položka ještě není ověřená (pro tyhle soubory)
function needsCheck(ctx, item) {
  if (!ctx.store.settings.verifySpeech || !S.available()) return false;
  return !item.langCheck || !sameIds(item.langCheck.fileIds, item.current?.fileIds);
}

// Použít uložené ověření na aktuální stav položky (volá se po každém načtení knihovny)
function applyLangCheck(item) {
  const lc = item.langCheck;
  if (!lc || !item.current) return item;
  if (!sameIds(lc.fileIds, item.current.fileIds)) {
    delete item.langCheck;
    return item;
  }
  if (lc.error) return item;
  item.current.verified = true;
  if (lc.corrected) {
    item.current.tagAudio = item.current.audio;
    item.current.tagTier = item.current.tier;
    item.current.tier = lc.tier;
    item.current.audio = lc.audio;
    item.current.audioSource = 'poslech';
  }
  return item;
}

// Soubory k ověření: film celý, u série nejvýš 3 epizody (první, prostřední, poslední)
async function filesFor(ctx, item) {
  if (item.app === 'radarr') {
    const m = await ctx.radarr.get(`/movie/${item.arrId}`);
    return m.movieFile ? [{ id: m.movieFile.id, path: m.movieFile.path }] : [];
  }
  const files = (await ctx.sonarr.get('/episodefile', { seriesId: item.arrId }))
    .filter((f) => f.seasonNumber === item.season)
    .sort((a, b) => String(a.relativePath).localeCompare(String(b.relativePath)));
  const pick = [...new Set([0, Math.floor(files.length / 2), files.length - 1])].filter((i) => files[i]);
  return pick.map((i) => ({ id: files[i].id, path: files[i].path }));
}

// Whisper na GPU a velikost modelu podle nastavení
const speechOpts = (settings) => ({ gpu: Boolean(settings.useGpu), model: settings.speechModel || 'base' });

async function checkFile(file, origLang, opts = {}) {
  const p = await A.probe(file.path);
  const tracks = [];
  for (const t of p.audio.slice(0, S.MAX_TRACKS)) {
    const det = await S.detectStream(p.file, t.index, { duration: p.duration, startTime: p.startTime, ...opts });
    const r = S.reconcile(t.lang || null, det, origLang);
    tracks.push({
      index: t.index, title: t.title || '', tag: t.lang || null,
      detected: det.lang, confidence: det.confidence, samples: det.samples,
      used: r.lang, corrected: r.corrected,
    });
  }
  const used = tracks.map((t) => t.used).filter(Boolean);
  const tier = L.tierOf({ pri: used.includes(L.primary()), sec: used.includes(L.secondary()) }, origLang);
  return { id: file.id, name: file.path.split('/').pop(), tier, tracks, audio: used.map(tagOut).join('/') || '?' };
}

/**
 * Ověří položku poslechem a uloží výsledek. Vrací { changed, before, after, langCheck }.
 * `changed` = úroveň jazyka se oproti značkám změnila.
 */
async function verify(ctx, item, { reason = I18N.t('langcheck.reason.verify') } = {}) {
  const { store } = ctx;
  const files = await filesFor(ctx, item);
  if (!files.length) return { changed: false };
  const label = require('./search').itemLabel(item);
  const t0 = Date.now();
  const results = [];
  for (const f of files) results.push(await checkFile(f, item.origLang, speechOpts(store.settings)));

  const fresh = store.s.items[item.key] || item;
  const before = fresh.current.tagTier ?? fresh.current.tier;
  const corrected = results.some((r) => r.tracks.some((t) => t.corrected));
  fresh.langCheck = {
    fileIds: fresh.current.fileIds,
    at: new Date().toISOString(),
    corrected,
    tier: Math.min(...results.map((r) => r.tier)),
    audio: [...new Set(results.map((r) => r.audio))].join(' | '),
    sampled: results.length,
    files: results,
    ms: Date.now() - t0,
  };
  // Znovu spočítat aktuální stav ze značek a ověření použít
  if (fresh.current.tagAudio) {
    fresh.current.audio = fresh.current.tagAudio;
    fresh.current.tier = fresh.current.tagTier;
    delete fresh.current.tagAudio;
    delete fresh.current.tagTier;
    if (fresh.current.audioSource === 'poslech') fresh.current.audioSource = 'mediainfo';
  }
  applyLangCheck(fresh);
  const after = fresh.current.tier;

  const fixes = results.flatMap((r) => r.tracks.filter((t) => t.corrected).map((t) => `${t.tag ? tagOut(t.tag) : I18N.t('langcheck.noTag')} → ${tagOut(t.used)}`));
  store.log(corrected ? 'warn' : 'info', corrected
    ? I18N.t('langcheck.mislabeled', { label, fixes: [...new Set(fixes)].join(', '), actual: tierText(after, fresh), reason })
    : I18N.t('langcheck.tagsOk', { label, audio: fresh.langCheck.audio, reason }));
  store.save();
  return { changed: before !== after, before, after, langCheck: fresh.langCheck };
}

// Návrh po ověření: nechat jen kandidáty, kteří jsou pořád lepší
function prune(ctx, p, item, { note } = {}) {
  const st = ctx.store.settings;
  const cur = item.current;
  const { neededLang } = require('./merge');
  const want = require('./watch').wantOf(ctx.store, item);
  const need = neededLang(item, want);
  const sc = (t) => L.wantScore(t, want, item.origLang);
  const wantCodec = require('./codec').wantRank(require('./watch').codecOf(ctx.store, item));
  const codecBetter = (c) => wantCodec != null && cur.vcodec != null && cur.vcodec < wantCodec && c.vcodec != null && c.vcodec >= wantCodec
    && sc(c.tier) >= sc(cur.tier) && c.res >= cur.res;
  const keep = (p.candidates || []).filter((c) => (c.kind === 'merge'
    ? c.mergeLang === need
    : sc(c.tier) > sc(cur.tier) || codecBetter(c) || (st.qualityUpgrades && c.tier === cur.tier && c.res > cur.res)));
  const removed = (p.candidates || []).length - keep.length;
  p.candidates = keep;
  p.current = { ...cur };
  if (!keep.length) {
    p.status = 'expired';
    p.note = note || I18N.t('langcheck.note.alreadyHas', { tier: tierText(cur.tier, item) });
  }
  p.updatedAt = new Date().toISOString();
  return removed;
}

// Na pozadí: ověřit položky čekajících návrhů, které vznikly bez ověření
class LangChecker {
  constructor(ctx) {
    this.ctx = ctx;
    this.running = false;
    this.current = null;
  }

  async tick() {
    const { store, searcher } = this.ctx;
    if (this.running || this.current || searcher.busy || !store.settings.verifySpeech || !S.available()) return;
    const p = Object.values(store.s.proposals).find((x) => x.status === 'pending' && !x.groupKey
      && store.s.items[x.itemKey] && needsCheck(this.ctx, store.s.items[x.itemKey])
      && !this.ctx.busyKeys().has(x.itemKey));
    if (!p) return;
    const item = store.s.items[p.itemKey];
    this.running = true;
    this.current = item.key;
    try {
      const r = await verify(this.ctx, item, { reason: I18N.t('langcheck.reason.pending') });
      if (r.changed && p.status === 'pending') prune(this.ctx, p, store.s.items[item.key] || item);
    } catch (e) {
      // ať se to nezkouší pořád dokola – poznamenat neúspěch k souborům
      item.langCheck = { fileIds: item.current.fileIds, at: new Date().toISOString(), error: e.message, corrected: false };
      store.log('warn', I18N.t('search.langCheckFailed', { label: item.title, error: e.message }));
    } finally {
      this.running = false;
      this.current = null;
      store.save();
    }
  }
}

module.exports = { speechOpts, needsCheck, applyLangCheck, verify, prune, LangChecker, sameIds };
