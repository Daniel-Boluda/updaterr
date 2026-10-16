const test = require('node:test');
const assert = require('node:assert');
require('../src/i18n').setLocale('cs'); // testy ověřují české texty
const { Inbox } = require('../src/inbox');
const { Notifier } = require('../src/notify');

const fakeStore = () => ({ s: { settings: { notifyDownloads: true } }, get settings() { return this.s.settings; }, save() {} });

test('přidání, přečtení, smazání a úklid přečtených', () => {
  const store = fakeStore();
  const inbox = new Inbox(store);
  const a = inbox.add({ kind: 'download', level: 'ok', title: 'A' });
  inbox.add({ kind: 'error', level: 'error', title: 'B' });
  assert.strictEqual(inbox.unread(), 2);
  inbox.markRead([a.id]);
  assert.strictEqual(inbox.unread(), 1);
  inbox.clear(true);
  assert.deepStrictEqual(inbox.list.map((n) => n.title), ['B']);
  inbox.remove(inbox.list[0].id);
  assert.strictEqual(inbox.list.length, 0);
});

test('stejná událost (key) se sloučí, znovu se označí jako nepřečtená a posune na konec', () => {
  const inbox = new Inbox(fakeStore());
  const e = inbox.add({ kind: 'error', title: 'Chyba', text: 'x', key: 'e:x' });
  inbox.add({ kind: 'download', title: 'jiná' });
  inbox.markRead(null);
  const again = inbox.add({ kind: 'error', title: 'Chyba', text: 'x', key: 'e:x' });
  assert.strictEqual(again.id, e.id);
  assert.strictEqual(again.count, 2);
  assert.strictEqual(again.read, false);
  assert.strictEqual(inbox.list.length, 2);
  assert.strictEqual(inbox.list.at(-1).id, e.id);
});

test('z logu se berou jen chyby', () => {
  const inbox = new Inbox(fakeStore());
  inbox.fromLog({ level: 'warn', msg: 'něco' });
  inbox.fromLog({ level: 'error', msg: 'Radarr nedostupný\nstack…' });
  inbox.fromLog({ level: 'error', msg: 'Radarr nedostupný\nstack…' });
  assert.strictEqual(inbox.list.length, 1);
  assert.strictEqual(inbox.list[0].text, 'Radarr nedostupný');
  assert.strictEqual(inbox.list[0].count, 2);
});

test('limit počtu položek', () => {
  const inbox = new Inbox(fakeStore());
  for (let i = 0; i < 320; i++) inbox.add({ kind: 'download', title: String(i) });
  assert.strictEqual(inbox.list.length, 300);
  assert.strictEqual(inbox.list[0].title, '20');
});

test('Notifier ukládá do centra i bez Telegramu/ntfy', async () => {
  const store = fakeStore();
  const ctx = { store };
  ctx.inbox = new Inbox(store);
  const n = new Notifier(ctx, {});
  await n.download({ id: 'j1', type: 'download', label: 'Film (2020)', itemKey: 'radarr:1', prev: { tier: 1 }, result: { tier: 3, audio: 'cze, eng', quality: '1080p' } }, 'done');
  await n.download({ id: 'j2', type: 'merge', label: 'Seriál – 01. série', itemKey: 'sonarr:5:1', message: 'nesedí synchronizace' }, 'failed');
  await n.backupReview({ id: 'j3', type: 'merge', label: 'X', backupCheck: { issues: [{ file: 'a.mkv', msg: 'kratší' }] } });
  const [done, failed, backup] = ctx.inbox.list;
  assert.match(done.title, /Upgrade hotový: Film/);
  assert.strictEqual(done.text, 'EN → CZ + EN (cze, eng, 1080p)');
  assert.deepStrictEqual(done.link, { item: 'radarr:1', job: 'j1' });
  assert.strictEqual(failed.kind, 'merge');
  assert.strictEqual(failed.level, 'error');
  assert.match(failed.title, /Přidání zvuku selhalo/);
  assert.strictEqual(backup.kind, 'backup');
  assert.match(backup.text, /a\.mkv: kratší/);
});
