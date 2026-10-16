// Tenký klient pro Radarr / Sonarr v3 API.
const LANGS = require('./languages');

class ArrClient {
  constructor(kind, url, apiKey) {
    this.kind = kind; // 'radarr' | 'sonarr'
    this.url = String(url || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  get enabled() {
    return Boolean(this.url && this.apiKey);
  }

  async req(method, path, { query, body, timeoutMs = 60_000 } = {}) {
    const u = new URL(this.url + '/api/v3' + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
      else u.searchParams.set(k, v);
    }
    const res = await fetch(u, {
      method,
      headers: { 'X-Api-Key': this.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = typeof data === 'object' && data ? (data.message || data.title || JSON.stringify(data)) : text;
      const err = new Error(`${this.kind} ${method} ${path} → HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  get(path, query, opts) { return this.req('GET', path, { query, ...opts }); }
  post(path, body, opts) { return this.req('POST', path, { body, ...opts }); }
  del(path, query) { return this.req('DELETE', path, { query }); }

  status() { return this.get('/system/status', null, { timeoutMs: 10_000 }); }

  // Interaktivní vyhledávání – prochází všechny indexery (Prowlarr). Může trvat i minutu+.
  searchReleases(params) { return this.get('/release', params, { timeoutMs: 300_000 }); }

  // Stažení releasu z cache posledního hledání (cache drží ~30 min).
  grab(guid, indexerId) { return this.post('/release', { guid, indexerId }, { timeoutMs: 120_000 }); }

  // Sonarr: stažení s ručně zadaným seriálem a epizodami – obejde "Multi-season releases are not supported".
  // (Sonarr 4: ReleaseController.DownloadRelease, větev ShouldOverride; quality a languages jsou povinné.)
  grabOverride({ guid, indexerId, seriesId, episodeIds, quality, languages }) {
    return this.post('/release', { guid, indexerId, shouldOverride: true, seriesId, episodeIds, quality, languages }, { timeoutMs: 120_000 });
  }

  async queue() {
    const extra = this.kind === 'radarr' ? { includeMovie: false } : { includeSeries: false, includeEpisode: true };
    const d = await this.get('/queue', { page: 1, pageSize: 1000, includeUnknownMovieItems: false, ...extra });
    return d?.records || [];
  }

  // removeFromClient=false: jen přestat sledovat ve frontě (torrent dál seeduje)
  removeFromQueue(id, { blocklist = true, removeFromClient = true } = {}) {
    return this.del(`/queue/${id}`, { removeFromClient, blocklist, skipRedownload: true });
  }

  manualImportList(downloadId) {
    return this.get('/manualimport', { downloadId, filterExistingFiles: false }, { timeoutMs: 120_000 });
  }

  command(body) { return this.post('/command', body); }

  // Jazyky jako objekty Radarru/Sonarru ({ id, name }) pro ruční import – ID se mezi Radarrem a Sonarrem liší,
  // proto se berou z /language (jednou za běh)
  async languageObjs(codes) {
    this.langList ??= this.get('/language').catch((e) => { this.langList = null; throw e; });
    const list = await this.langList;
    return [...new Set(codes)].map((c) => {
      const names = LANGS.get(c)?.names || [];
      return list.find((l) => names.includes(l.name));
    }).filter(Boolean).map(({ id, name }) => ({ id, name }));
  }
}

module.exports = { ArrClient };
