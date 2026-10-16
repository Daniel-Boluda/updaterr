// Analýza zvukových stop (ffprobe) a kontrola synchronizace dvou stop přes korelaci zvukové obálky.
//
// Dabing a originál sdílejí hudbu a ruchy (M&E), takže "obálka" hlasitosti (nástupy zvuků) obou stop
// koreluje. V několika místech filmu najdeme posun, při kterém se obálky nejlépe překrývají. Když všechna
// místa dávají stejný posun, stopa sedí (případně s konstantním zpožděním, které při slučování vyrovnáme).
// Když se posun mezi místy liší, jde o jiný střih nebo jinou rychlost → nesloučit.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const L = require('./lang');
const LANGS = require('./languages');
const I18N = require('./i18n');

const RATE = 8000;        // Hz pro analýzu
const HOP = 80;           // vzorků na bod obálky → 10 ms
const FPS = RATE / HOP;   // 100 bodů obálky za sekundu

// okCodes: mkvmerge vrací 1 při pouhých varováních
function run(cmd, args, { timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && !(typeof err.code === 'number' && okCodes.includes(err.code))) return reject(new Error(I18N.t('common.cmdFailed', { cmd, error: (stderr || err.message).trim().split('\n').slice(-3).join(' | ') })));
      resolve(stdout);
    });
  });
}

// Jazyk stopy: značka v souboru, případně název stopy ("CZ dabing", "Czech DD 5.1", "Original")
function streamLang(s) {
  const tag = L.normLangCode(s.tags?.language);
  if (tag) return { lang: tag, from: 'tag' };
  const words = String(s.tags?.title || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const named = words.map(LANGS.fromToken).find(Boolean);
  if (named) return { lang: named, from: 'title' };
  // "Dabing" bez jazyka = dabing v primárním jazyce, "Original" = druhý jazyk (obvykle originál)
  const pri = LANGS.get(L.primary());
  if (pri && words.some((w) => pri.dub.includes(w))) return { lang: pri.code, from: 'title' };
  if (L.secondary() && words.includes('original')) return { lang: L.secondary(), from: 'title' };
  return { lang: null, from: null };
}

function parseFps(r) {
  const [a, b] = String(r || '0/1').split('/').map(Number);
  return b ? a / b : a || 0;
}

async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 60_000 });
  const d = JSON.parse(out);
  const streams = d.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
    index: s.index,           // index ve všech streamech (pro ffmpeg -map 0:N)
    audioIndex: i,            // pořadí mezi audio stopami
    codec: s.codec_name,
    channels: s.channels,
    title: s.tags?.title || '',
    default: Boolean(s.disposition?.default),
    ...streamLang(s),
  }));
  return {
    file,
    duration: Number(d.format?.duration) || 0,
    // ffmpeg -ss počítá od začátku souboru; kvůli zpožděným stopám/souborům přepočítáváme na časovou osu kontejneru
    startTime: Number(d.format?.start_time) || 0,
    size: Number(d.format?.size) || 0,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: parseFps(v.avg_frame_rate || v.r_frame_rate) } : null,
    audio,
  };
}

// Skutečná snímková frekvence z časových značek snímků. Hlavička MKV bývá zaokrouhlená na celé ms
// (42 ms/snímek → „23,810 fps“), přestože video má 23,976 fps – rozhodovat podle ní by mohlo zbytečně odmítnout.
function fpsFromPts(pts) {
  const t = pts.filter(Number.isFinite).sort((a, b) => a - b);
  return t.length > 10 && t[t.length - 1] > t[0] ? (t.length - 1) / (t[t.length - 1] - t[0]) : 0;
}

// Měří 60 s videa od 10 % délky (mimo úvodní logo)
async function measureFps({ file, duration = 0, startTime = 0 }) {
  const from = startTime + Math.max(0, Math.round(duration * 0.1));
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${from}%+60`,
    '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { timeoutMs: 60_000 });
  return fpsFromPts(out.split('\n').map((l) => parseFloat(l)));
}

// Kontrola na pozadí: ffmpeg s nejnižší prioritou CPU i disku (ionice v Alpine je, jinde se přeskočí)
const IONICE = ['/usr/bin/ionice', '/bin/ionice'].find((f) => fs.existsSync(f));

// Dekóduje úsek jedné nebo více stop téhož souboru do mono PCM 8 kHz (pole Float32Array, jedno na stopu).
// Víc stop = jedno čtení souboru (každá stopa má vlastní rouru). `start` je čas na ose kontejneru.
function decode({ file, startTime = 0 }, streams, start, duration, { lowPriority = false } = {}) {
  start -= startTime;
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(duration), '-i', file];
    streams.forEach((s, k) => args.push('-map', `0:${s}`, '-ac', '1', '-ar', String(RATE), '-f', 's16le', `pipe:${3 + k}`));
    const [cmd, pre] = lowPriority && IONICE ? [IONICE, ['-c', '3', 'ffmpeg']] : ['ffmpeg', []];
    const p = spawn(cmd, [...pre, ...args], { stdio: ['ignore', 'ignore', 'pipe', ...streams.map(() => 'pipe')] });
    if (lowPriority) try { os.setPriority(p.pid, 19); } catch { /* proces už skončil */ }
    const chunks = streams.map(() => []);
    let err = '';
    streams.forEach((s, k) => p.stdio[3 + k].on('data', (c) => chunks[k].push(c)));
    p.stderr.on('data', (c) => (err += c));
    const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`ffmpeg: ${err.trim().split('\n').pop() || I18N.t('common.exitCode', { code })}`));
      resolve(chunks.map((list) => {
        const buf = Buffer.concat(list);
        const n = buf.length >> 1;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
        return out;
      }));
    });
  });
}

const pcm = (src, start, duration, opts) => decode(src, [src.stream], start, duration, opts).then((x) => x[0]);

// Obálka nástupů: log-energie v 10ms oknech → kladná derivace → z-normalizace
function envelope(samples) {
  const n = Math.floor(samples.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) s += samples[j] * samples[j];
    e[i] = Math.log10(1e-8 + s / HOP);
  }
  const o = new Float32Array(n);
  for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += o[i];
  mean /= n || 1;
  let v = 0;
  for (let i = 0; i < n; i++) v += (o[i] - mean) ** 2;
  const sd = Math.sqrt(v / (n || 1)) || 1;
  for (let i = 0; i < n; i++) o[i] = (o[i] - mean) / sd;
  return o;
}

// Najde posun b vůči a (v bodech obálky) v rozsahu ±maxLag. a je kratší úsek, b je delší o 2*maxLag.
function bestLag(a, b, maxLag) {
  const scores = new Float32Array(2 * maxLag + 1);
  for (let L = -maxLag; L <= maxLag; L++) {
    let s = 0;
    const off = maxLag + L;
    for (let i = 0; i < a.length; i++) s += a[i] * (b[i + off] || 0);
    scores[L + maxLag] = s / a.length;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  // "Výraznost" vrcholu: kolik směrodatných odchylek nad ostatními posuny (mimo okolí vrcholu)
  let mean = 0, cnt = 0;
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - best) > 5) { mean += scores[i]; cnt++; }
  mean /= cnt || 1;
  let v = 0;
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - best) > 5) v += (scores[i] - mean) ** 2;
  const sd = Math.sqrt(v / (cnt || 1)) || 1e-9;
  // Jemnější odhad (parabola přes vrchol)
  let frac = 0;
  if (best > 0 && best < scores.length - 1) {
    const y0 = scores[best - 1], y1 = scores[best], y2 = scores[best + 1];
    const den = y0 - 2 * y1 + y2;
    if (den) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  return { lag: best - maxLag + frac, peak: scores[best], z: (scores[best] - mean) / sd };
}

// Pořadí měřených míst tak, aby i prvních pár pokrylo celý film (0, 7, 4, 2, 5, 1, 3, 6 pro 8 míst)
function spreadOrder(n) {
  const out = n > 1 ? [0, n - 1] : [0];
  for (let step = (n - 1) / 2; out.length < n && step >= 0.5; step /= 2) {
    for (let x = step; x < n - 1; x += 2 * step) if (!out.includes(Math.round(x))) out.push(Math.round(x));
  }
  for (let k = 0; k < n; k++) if (!out.includes(k)) out.push(k);
  return out;
}

// Nejpočetnější skupina posunů, které se od sebe liší nejvýš o toleranceMs
function tightestCluster(offsets, toleranceMs) {
  const s = [...offsets].sort((x, y) => x - y);
  let best = 0;
  for (let i = 0, j = 0; j < s.length; j++) {
    while (s[j] - s[i] > toleranceMs) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

/**
 * Výsledek z naměřených míst ({ at, offsetMs, z }, v pořadí podle času).
 * `anchors` = kolik míst se mělo měřit; při předčasném ukončení jich je v results míň.
 */
function syncVerdict(results, { anchors = results.length, minZ = 7, toleranceMs = 60, minValid = 5 } = {}) {
  const valid = results.filter((r) => r.z >= minZ);
  if (valid.length < minValid) {
    return { ok: false, anchors: results, reason: I18N.t('sync.verdict.noMatch', { valid: valid.length, anchors }) };
  }
  const sorted = valid.map((r) => r.offsetMs).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agree = valid.filter((r) => Math.abs(r.offsetMs - median) <= toleranceMs);
  if (agree.length < minValid) {
    const spread = sorted[sorted.length - 1] - sorted[0];
    const drift = valid.length >= 2 && Math.abs(valid[valid.length - 1].offsetMs - valid[0].offsetMs) > toleranceMs * 3 &&
      valid.every((r, i) => i === 0 || r.offsetMs >= valid[i - 1].offsetMs - toleranceMs) ? I18N.t('sync.verdict.drift') : I18N.t('sync.verdict.otherCut');
    return { ok: false, anchors: results, reason: I18N.t('sync.verdict.varies', { spread, drift }) };
  }
  const offsetMs = Math.round(agree.reduce((s, r) => s + r.offsetMs, 0) / agree.length);
  return { ok: true, offsetMs, anchors: results, matched: `${agree.length}/${results.length}` };
}

/**
 * Smí měření skončit dřív? Ano, když už je výsledek jistý:
 *  - shoduje se nadpoloviční většina všech míst → ať zbylá místa vyjdou jakkoli, medián zůstane ve shodné skupině,
 *  - nebo už ani zbylá místa nemůžou dát potřebný počet platných měření.
 */
function canStopEarly(results, { anchors, minZ = 7, toleranceMs = 60, minValid = 5 }) {
  const valid = results.filter((r) => r.z >= minZ);
  if (valid.length + (anchors - results.length) < minValid) return true;
  return minValid * 2 > anchors && tightestCluster(valid.map((r) => r.offsetMs), toleranceMs) >= minValid;
}

/**
 * Porovná stopu `donor` se stopou `ref` ({ file, stream, duration, startTime } – stream = index z probe()).
 * Vrací { ok, offsetMs, anchors, matched, reason }.
 * offsetMs = o kolik je potřeba donor posunout (mkvmerge --sync TID:offsetMs), aby seděl na ref.
 * earlyStop: skončit, jakmile je výsledek jistý (šetří čtení disku); lowPriority: ffmpeg s nízkou prioritou.
 * Obě stopy ze stejného souboru se dekódují jedním čtením.
 */
async function checkSync(ref, donor, { maxOffsetSec = 30, segmentSec = 60, anchors = 8, minZ = 7, toleranceMs = 60, minValid = 5, earlyStop = false, lowPriority = false } = {}) {
  const dur = Math.min(ref.duration, donor.duration + maxOffsetSec);
  if (!dur || dur < segmentSec * 3) return { ok: false, reason: I18N.t('sync.verdict.tooShort') };
  const maxLag = Math.round(maxOffsetSec * FPS);
  const sameFile = ref.file === donor.file && (ref.startTime || 0) === (donor.startTime || 0);
  const vopts = { anchors, minZ, toleranceMs, minValid };
  const results = [];
  for (const k of earlyStop ? spreadOrder(anchors) : [...Array(anchors).keys()]) {
    const t = dur * (0.08 + (0.84 * k) / Math.max(1, anchors - 1));
    const start = Math.min(t, ref.duration - segmentSec - 1);
    let ra, da;
    if (sameFile) {
      // Jedno okno pro obě stopy; ref je jeho prostředek (začátek zarovnaný na celé body obálky)
      const [wr, wd] = await decode(ref, [ref.stream, donor.stream], start - maxOffsetSec, segmentSec + 2 * maxOffsetSec, { lowPriority });
      const winStart = Math.max(ref.startTime || 0, start - maxOffsetSec);
      const off = Math.round(((start - winStart) * RATE) / HOP) * HOP;
      ra = wr.subarray(off, off + segmentSec * RATE);
      da = wd;
    } else {
      [ra, da] = await Promise.all([
        pcm(ref, start, segmentSec, { lowPriority }),
        pcm(donor, start - maxOffsetSec, segmentSec + 2 * maxOffsetSec, { lowPriority }),
      ]);
    }
    const a = envelope(ra);
    let b = envelope(da);
    // Začátek filmu: donor nejde číst před 0 → doplnit nulami zleva
    const missing = Math.round(Math.max(0, maxOffsetSec - start + (donor.startTime || 0)) * FPS);
    if (missing) { const nb = new Float32Array(b.length + missing); nb.set(b, missing); b = nb; }
    const r = bestLag(a, b, maxLag);
    results.push({ at: Math.round(start), offsetMs: Math.round((-r.lag * 1000) / FPS), z: Math.round(r.z * 10) / 10 });
    if (earlyStop && results.length < anchors && canStopEarly(results, vopts)) break;
  }
  results.sort((x, y) => x.at - y.at);
  return syncVerdict(results, vopts);
}

module.exports = { probe, measureFps, fpsFromPts, checkSync, syncVerdict, canStopEarly, spreadOrder, streamLang, run };
