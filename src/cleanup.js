// Úklid qBittorrentu po importu: torrenty stažené přes Radarr/Sonarr (upgrady z Updaterru) po dokončení smazat
// i se staženými soubory – v knihovně zůstává importovaná kopie (hardlink/kopie, Radarr/Sonarr torrent nikdy
// nepřesouvá). qBittorrent má na to vlastní limit seedování, ale vynucené torrenty (Force start) ho ignorují
// a Radarr/Sonarr „Remove completed“ čeká, až je qBittorrent zastaví – takže by seedovaly navždy.
// Prochází i starší hotová stahování, takže po zapnutí uklidí i to, co v qBittorrentu zůstalo z dřívějška.
const { t: tr } = require('./i18n');

const hashOf = (x) => String(x || '').toLowerCase();
const partsOf = (d) => d.parts || [{ downloadId: d.downloadId }];

/**
 * Rozhodne, které torrenty smazat. `downloads` = záznamy stahování, `torrents` = torrents/info z qBittorrentu,
 * `busy` = hashe, které zrovna používá jiná běžící úloha (nesahat). Vrací [{ d, hashes }] – `hashes` může být
 * prázdné (v qBittorrentu už nic není), záznam se pak jen označí jako uklizený.
 */
function plan(downloads, torrents, busy) {
  const present = new Set(torrents.map((t) => hashOf(t.hash)));
  const out = [];
  for (const d of downloads) {
    if (d.state !== 'done' || d.torrentsRemoved) continue;
    const hashes = [...new Set(partsOf(d).map((p) => hashOf(p.downloadId)).filter(Boolean))];
    if (hashes.some((h) => busy.has(h))) continue; // stejný torrent stahuje jiná úloha – počkat, až doběhne
    out.push({ d, hashes: hashes.filter((h) => present.has(h)) });
  }
  return out;
}

class TorrentCleanup {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async tick() {
    const { store, qbit, downloads, merger } = this.ctx;
    if (!store.settings.qbitRemoveImported || !qbit?.enabled) return;
    const all = Object.values(store.s.downloads);
    if (!all.some((d) => d.state === 'done' && !d.torrentsRemoved)) return;
    const busy = new Set([
      ...downloads.active().flatMap((d) => partsOf(d).map((p) => hashOf(p.downloadId))),
      ...merger.active().map((j) => hashOf(j.hash)),
    ].filter(Boolean));
    const torrents = (await qbit.req('torrents/info')) || [];
    const todo = plan(all, torrents, busy);
    const removed = [];
    for (const { d, hashes } of todo) {
      if (hashes.length) {
        await qbit.delete(hashes.join('|'), true);
        removed.push(d.label);
      }
      d.torrentsRemoved = Date.now();
    }
    if (removed.length) {
      const shown = removed.slice(0, 5).join(', ') + (removed.length > 5 ? tr('cleanup.andMore', { count: removed.length - 5 }) : '');
      store.log('info', tr('cleanup.removed', { count: removed.length, names: shown }));
    }
    if (todo.length) store.save();
  }
}

module.exports = { TorrentCleanup, plan };
