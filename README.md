# Updaterr

*[Česky](README.cs.md)*

Updaterr goes through your Radarr and Sonarr library and looks for better versions of what you already have –
first by **audio language**, then by resolution. You pick the dub language you want (German, Polish, Czech,
French, …) and a second language (usually the original, English). The order is:

**both languages › only the wanted dub › only the second language**, and with the same languages a higher resolution.

Found upgrades are offered for approval (web UI, Telegram or ntfy), or downloaded automatically for watched
movies and series. Updaterr can also **add a missing audio track** to the file you already have (e.g. a 4K English
file + a German dub from another release), with an automatic sync check.

- The real language comes from the **audio tracks of the file** (MediaInfo), not from the file name – and can be
  double-checked by **listening** to the tracks with Whisper, because track tags lie.
- Release titles are parsed for language mentions in many conventions (`German.DL`, `MULTi.VFF`, `PL.Lektor`,
  `(CZ/EN)`, `CZ titulky`…), telling dubs from subtitles.
- Radarr/Sonarr quality profiles and custom formats are deliberately **ignored** – they don't understand dubbing.
- The UI is available in English and Czech; adding a language is one JSON file per side (see [Translations](#translations)).

## Quick start (Docker)

```bash
git clone https://github.com/<you>/updaterr.git && cd updaterr
cp .env.example .env              # fill in addresses, API keys and paths
docker compose up -d --build
```

Open `http://<server>:5290` (port `UPDATERR_PORT`) and choose your languages in **Settings → Languages**
(or set `PRIMARY_LANGUAGE` / `SECOND_LANGUAGE` in `.env`). Until a dub language is chosen, the library is not scanned.

### What goes where

| File | What |
| --- | --- |
| `.env` | Everything environment-specific: port and bind address, Radarr/Sonarr URLs and API keys, media paths, qBittorrent, notifications, password. Template: [`.env.example`](.env.example). |
| `docker-compose.yaml` | Generic service definition – no addresses or paths hardcoded. |
| `docker-compose.override.yaml` | Your server-specific additions (Docker network of your *arr stack, Radarr/Sonarr `config.xml` mounts). Loaded automatically by Compose, ignored by git. Template: [`docker-compose.override.example.yaml`](docker-compose.override.example.yaml). |
| `docker-compose.gpu.yaml` | Optional GPU (Vulkan) for speech recognition. |
| `docker-compose.preview.yaml` | Read-only preview on another port (see below). |
| UI → **Settings** | Everything else: languages, intervals, limits, seeders, merging, automation. Stored in `data/state.json`. |

**Paths:** the media library must be mounted under the **same path** Radarr, Sonarr and qBittorrent use
(`MEDIA_HOST_DIR` on the host → `MEDIA_DIR` in the container). `STAGING_DIR` (donor downloads and backups)
should live inside it, so backups are hardlinks on the same disk.

### Read-only preview on another port

Run a second instance next to the real one – e.g. to try a new version against your real library:

```bash
mkdir -p data-preview && cp data/state.json data-preview/     # optional: start from your current data (preview stopped)
docker compose -p updaterr-preview -f docker-compose.preview.yaml up -d --build
# → http://<server>:5291  (PREVIEW_PORT)
docker compose -p updaterr-preview -f docker-compose.preview.yaml down
```

With `READ_ONLY=true` it only reads the library from Radarr/Sonarr: no searches, downloads, imports, deletions or
notifications, and the media library is mounted read-only. Settings can be changed (they only affect the copy).
If Radarr/Sonarr are reachable only inside a Docker network, add that network the same way as in the override
template (`-f docker-compose.preview.yaml -f your-preview.local.yaml`).

### Without Docker

Node.js 22+, no npm dependencies. For merging, sync checks and speech detection you also need `ffmpeg`/`ffprobe`,
`mkvtoolnix` and `whisper-cli` from whisper.cpp with the models (see the [Dockerfile](Dockerfile)).

```bash
RADARR_URL=http://localhost:7878 RADARR_API_KEY=… PRIMARY_LANGUAGE=de PORT=5290 npm start
```

## How it works

1. **Library** – every hour the movies and series are loaded. The actual language comes from the file's
   **audio tracks** (MediaInfo from Radarr/Sonarr). When MediaInfo doesn't know the language (`und`), the guess
   from the file name is used and marked as “guess” in the UI.
2. **Search** – one item at a time (default 1 per 90 s, so indexers aren't hammered) Updaterr runs Radarr/Sonarr's
   interactive search, i.e. across all indexers from Prowlarr. Order: watched items, never checked, second
   language only, unknown, dub only. Items with nothing better are retried after `recheckDays`.
3. **Evaluation** – the release language is read from the title (`(CZ/EN)`, `German.DL`, `MULTi`, `VFF`,
   `Lektor`, `MultiDub`…), recognizing that `CZ titulky`, `VOSTFR`, `Napisy`, `Sub` are subtitles, not dubs.
   A release with no language mentioned is the original language. For works whose original *is* the wanted dub
   language, the original alone is the goal. Dead torrents (fewer than 3 seeders), CAM/TS/3D, releases outside
   720p–1080p, oversized releases and “Unknown movie” are dropped.
4. **Proposal** – up to 5 candidates ranked by language, confidence, resolution and seeders. Approve in the web UI
   or with a Telegram button. Buttons point to a specific release, so a re-search can't make you grab a different one.
5. **Download** – if the search result is older than 20 min, it is re-verified that the torrent is alive. Then the queue is watched:
   - **no progress for 3 h** → remove from the client, blocklist and grab the next candidate (max. 3 attempts);
     a slow but live torrent isn't considered dead,
   - Radarr/Sonarr refuses the import because by *its* rules it's “not an upgrade” → **forced manual import**,
   - after import the **audio tracks of the new file are verified**; if the release lied about its language, you
     get a warning and the release is blocklisted,
   - if the download fails or you cancel it, the proposal reopens with the remaining candidates.

### Language check by listening

Language tags in tracks sometimes lie – e.g. YouTube rips with a dubbed track tagged `eng`. Before proposing
anything, Updaterr “listens” to the tracks of the current file: it takes 90 s of audio from several places, a
voice activity detector (Silero VAD) keeps only the speech, and **Whisper** (`whisper.cpp`, model `base`,
running locally in the container) identifies the language. When the speech clearly differs from the tag, the
heard language wins and pointless proposals disappear. Closely related languages that Whisper mixes up
(Czech × Slovak, Croatian × Serbian × Bosnian, Indonesian × Malay) keep the tag. For series 3 episodes per
season are checked. It takes about 8 s per track; it can be switched off in Settings.

### GPU

Speech recognition can run on a GPU via **Vulkan** (`docker-compose.gpu.yaml`). It's the only task that benefits
from a GPU – it speeds up Whisper and frees the CPU for the torrent client and media server, so the more accurate
**small** model becomes practical. If the GPU is missing or fails, the CPU takes over and the GPU isn't retried
for 30 min. Settings → **GPU** has a **Check** button that verifies the device, permissions and Vulkan driver and
compares a test transcription with the CPU.

### Merging audio tracks (two releases → one file)

When you have e.g. a movie with English only and a German release exists, Updaterr offers – besides replacing the
whole file – **“Add DE audio”**: the video and other tracks stay from your current file.

1. It downloads the “donor” release **directly into qBittorrent** (category `updaterr`, outside Radarr), and from the
   torrent only the needed video (for series only the missing episodes). The video is downloaded **sequentially**
   and after the first ~48 MB its frame rate is probed – a **clearly different fps** (more than 2 %, e.g. PAL 25 vs
   23.976) rejects the donor right away.
2. Based on the **real audio tracks** (ffprobe) it verifies the donor really contains the language.
3. It checks the frame rate and duration.
4. **Synchronization**: at 8 places in the movie it compares the audio “envelope” (music and effects are the same
   in the dub and the original) and finds the offset. A different cut or gradual drift is detected and not merged.
5. It merges with `mkvmerge` (with the found offset, the dub as the default track) and **verifies the result again**.
6. It backs up the original file (hardlink; no backup = no change) and imports the result through Radarr/Sonarr.

Requires `QBIT_URL` + `QBIT_PASSWORD` and `STAGING_DIR`.

### Dub sync check for files with both languages

Files that already have both languages are **measured in the background** with the same method (dub vs original in
the same file), reading only ~7 % of the file at the lowest I/O priority. An offset above `syncWarnMs` (default
80 ms) shows in the **Library**; **Fix sync** in the item detail creates a new file with the dub tracks shifted
(`mkvmerge --sync`), measures it again, backs up the original and imports the new file.
In the *Dub out of sync* filter, **Fix all** queues a fix for every shown out-of-sync item that is idle; they run one by one.

### Backups

The **Backups** tab lists original files replaced by merging or sync fixes (`STAGING_DIR/backup/<job id>/`),
with retention by age (`keepBackupDays`, default 7) and total size (`maxBackupGB`), per-backup custom expiry or
immediate deletion.

### Watching movies and series

The eye icon in the **Library**. A watched item is checked more often (`watchIntervalDays`, default 2 days) and a
sure upgrade **is downloaded automatically** – you just get a notification. For series it applies to the whole
series, including seasons added later. Newly added titles can start being watched automatically
(Settings → Library scan → *Watch newly added*).

### Wanted languages per item

Item detail → **Wanted languages**: *both* (default), *dub only* or *second language only*. With one language the
goal is having that one; the other is ignored.

### Wanted video format

Item detail → **Video format**: *Don't care* (default), *H.265 / AV1* or *AV1 only*. When the file has an older codec
(per MediaInfo, e.g. H.264), Updaterr looks for a release with the **same or better language and the same or higher
resolution** in the wanted codec – offered as *Newer format*. The release codec is read from the title (`x265`,
`H.265`, `HEVC`, `AV1`, `x264`…); releases that don't state it aren't offered for the format. Levels: older (XviD,
MPEG-2…) › H.264 › H.265 / VP9 › AV1. The container (MKV, MP4) doesn't matter.

- Language comes first: a language upgrade is still offered in an older codec, just with an “older video format”
  warning, and candidates in the wanted codec are ranked first.
- A newer codec means the same picture in a smaller file, not automatically a better picture – your players must
  decode it, otherwise the media server transcodes.
- A newer format is downloaded automatically only for watched items with auto-upgrade. After import the codec of the
  new file is verified; a release that lied is blocklisted.

### Series: multi-season packs and episode sets

- **Multi-season packs** (`Show S01-S04 (DE/EN)`, `Show S01-S02 (CZ) / S03-S06 (EN)`) – the season range and the
  language of each part are read from the title; one proposal for all seasons it improves. Sonarr rejects such
  releases, so they're grabbed with explicit episodes (override).
- **Episode sets** – when a season has no usable pack but every episode below the goal has a live better release.

### Stalled torrents in qBittorrent

Settings → Downloads → *qBittorrent queue* (off by default). Applies to **all torrents** in qBittorrent:
a torrent stalled without peers for longer than `qbitStallMin` is stopped and tagged `updaterr-stalled`
to free the queue, and retried every `qbitStallRetryMin`.

### Torrent cleanup after import

Settings → Download and import → *Delete torrent after import* (`qbitRemoveImported`, on by default). Once an
upgrade grabbed through Radarr/Sonarr is imported, Updaterr deletes its torrent from qBittorrent **including the
downloaded files** – the library keeps the imported copy (hardlink or copy). Only torrents from Updaterr's own
downloads are touched (matched by hash). qBittorrent's seeding limit doesn't apply to force-started torrents, so
they would otherwise seed forever. Turn it off if you want to seed (ratio on private trackers).

### Notification center

The bell in the top bar collects the same events as Telegram/ntfy – **even without Telegram or ntfy configured**:
new proposals, automatic downloads and retries, finished upgrades, failures, blocked imports, backups to review and
errors from the log. A repeating event (e.g. Radarr unreachable) is merged into one entry with a count for 6 h.
Clicking an entry takes you to the place (proposal, activity row, item, backups, log). The last 300 entries are
kept, for at most 60 days.

## Integrations

### Telegram (recommended – “Download” buttons right in the message)
1. Create a bot with [@BotFather](https://t.me/BotFather) → token.
2. Message the bot, then find your chat id (`https://api.telegram.org/bot<TOKEN>/getUpdates` or @userinfobot).
3. In `.env`: `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_CHAT_ID=…`, then `docker compose up -d`.

The bot uses long polling, so it doesn't need a public address.

### Instant check of new downloads
Radarr and Sonarr → *Settings → Connect → + → Webhook*, tick **On File Import** and **On File Upgrade**:
- Radarr: `http://updaterr:8080/api/webhook/radarr`
- Sonarr: `http://updaterr:8080/api/webhook/sonarr`

(`updaterr` = the container name inside a shared Docker network; otherwise use the host and `UPDATERR_PORT`.)
With `WEBHOOK_TOKEN` add `?token=…`.

### Automation for the whole library
The default is **always ask**. Settings can switch to “Only sure goal versions” or “Any sure upgrade”.

## Languages

About 50 languages are built in ([`src/languages.js`](src/languages.js)): ISO 639-1/639-2 codes, the names Radarr
and Sonarr use, and the words release titles use for each language (dub and subtitle words included, e.g.
`Lektor`/`Napisy` for Polish, `VFF`/`VOSTFR` for French, `DL` for German). If your scene uses another word, add
it to the `tokens` / `dub` / `sub` lists – PRs welcome. **Local indexers** (Settings) are trackers whose `MULTI`
releases most likely include your dub language.

## Translations

- Web UI: [`public/locales/<lang>.json`](public/locales)
- Server (log, notifications, errors): [`src/locales/<lang>.json`](src/locales)

Copy `en.json` to a new language code in both folders and translate the values; the language then appears in
Settings → Languages → *Interface language*. Plural forms use `Intl.PluralRules` categories (`one`, `few`, `other`…).

## Limitations

- Packs without season numbers in the title (“Complete Series”) and releases Sonarr can't parse aren't offered.
- A candidate's language is estimated from the title – a bare `MULTI` is a “guess”. After download it's always
  verified from the audio tracks.
- Merging doesn't re-encode – a donor with a different frame rate (PAL 25 fps) is rejected.
- If a movie's Radarr profile allows upgrades and Updaterr picks e.g. a dubbed 720p over an English 1080p, Radarr may
  later try to “upgrade” it back. Disable upgrades in the profile, or use track merging.

## Development

```bash
npm test                      # language parser, codecs, seasons, candidates, downloads, merging, watching, sync, backups
docker compose up -d --build  # deploy
```

No npm dependencies – just Node.js 22+, ffmpeg, mkvtoolnix and whisper.cpp (in the container, with Vulkan for GPU).
The image is plain Alpine: Node.js from packages, ffmpeg built only with the parts the app uses, and Whisper
models in q8_0 quantization (same results as the full models at half the size).

## License

[MIT](LICENSE)
