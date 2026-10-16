// Notifikační centrum ve webu: stejné události jako Telegram/ntfy (návrhy, stahování, zálohy ke kontrole)
// a chyby z logu. Ukládá se do state.json (store.s.notifications), nejnovější na konci.
const { newId } = require('./store');
const I18N = require('./i18n');

const MAX = 300;
const MAX_AGE_DAYS = 60;
const MERGE_MS = 6 * 3600e3;   // stejná událost (key) do 6 h → jen zvýšit počet, ne nová položka

class Inbox {
  constructor(store) {
    this.store = store;
    if (!Array.isArray(store.s.notifications)) store.s.notifications = [];
  }

  get list() { return this.store.s.notifications; }

  // kind: proposal | download | merge | syncfix | backup | error
  // level: info | ok | warn | error
  // link: { proposal } | { item } | { tab }
  add({ kind, level = 'info', title, text = '', link = null, key = null }) {
    const now = new Date().toISOString();
    if (key) {
      const prev = this.list.findLast((n) => n.key === key);
      if (prev && Date.now() - Date.parse(prev.t) < MERGE_MS) {
        Object.assign(prev, { t: now, level, title, text, link, read: false, count: (prev.count || 1) + 1 });
        // přesunout na konec (nejnovější)
        this.list.splice(this.list.indexOf(prev), 1);
        this.list.push(prev);
        this.store.save();
        return prev;
      }
    }
    const n = { id: newId(), t: now, kind, level, title, text, link, key, read: false, count: 1 };
    this.list.push(n);
    this.prune();
    this.store.save();
    return n;
  }

  prune() {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400e3;
    const keep = this.list.filter((n) => Date.parse(n.t) >= cutoff);
    if (keep.length > MAX) keep.splice(0, keep.length - MAX);
    this.store.s.notifications = keep;
  }

  unread() { return this.list.reduce((a, n) => a + (n.read ? 0 : 1), 0); }

  markRead(ids) {
    const set = ids ? new Set(ids) : null;
    let changed = 0;
    for (const n of this.list) {
      if (!n.read && (!set || set.has(n.id))) { n.read = true; changed++; }
    }
    if (changed) this.store.save();
    return changed;
  }

  remove(id) {
    const before = this.list.length;
    this.store.s.notifications = this.list.filter((n) => n.id !== id);
    if (this.list.length !== before) this.store.save();
  }

  // onlyRead: smazat jen přečtené (nepřečtené zůstanou)
  clear(onlyRead = false) {
    this.store.s.notifications = onlyRead ? this.list.filter((n) => !n.read) : [];
    this.store.save();
  }

  // Chyby z logu (store.log('error', …)) – opakující se chyba (např. nedostupný Radarr) se sloučí
  fromLog(entry) {
    if (entry.level !== 'error') return;
    const msg = String(entry.msg || '');
    const first = msg.split('\n')[0];
    this.add({ kind: 'error', level: 'error', title: I18N.t('inbox.error'), text: first.slice(0, 400), key: `e:${first.slice(0, 120)}`, link: { tab: 'log' } });
  }
}

module.exports = { Inbox };
