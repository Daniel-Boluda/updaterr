// Formát (kodek) videa – stávajícího souboru (MediaInfo z Radarru/Sonarru) i releasu (z názvu).
//
// Úrovně (od nejstaršího): 0 = starší / neznámý (XviD, DivX, MPEG-2, VC-1), 1 = H.264, 2 = H.265 / VP9, 3 = AV1.
// Novější kodek = stejná kvalita obrazu při menší velikosti, ne automaticky lepší obraz.
// Kontejner (MKV, MP4) se neřeší – je to jen "obal", na kvalitu nemá vliv.
const I18N = require('./i18n');

const NAMES = { 1: 'H.264', 2: 'H.265', 3: 'AV1' };

// MediaInfo: "x264", "h264", "AVC", "x265", "h265", "HEVC", "AV1", "VP9", "XviD", "DivX", "VC1", "MPEG2"…
function rankOfCodec(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n) return null;
  if (n === 'av1' || n === 'av01') return 3;
  if (/^(x265|h265|hevc|vp9)$/.test(n)) return 2;
  if (/^(x264|h264|avc|avc1)$/.test(n)) return 1;
  return 0;
}

// Popisek pro UI: "H.265", u VP9 a starších kodeků jejich vlastní název ("XviD")
function nameOf(rank, raw) {
  if (rank === 2 && /vp9/i.test(raw || '')) return 'VP9';
  if (rank === 0) return raw ? String(raw) : I18N.t('codec.older');
  return NAMES[rank] ?? '?';
}

// Z názvu releasu: "x265", "H.265", "HEVC", "AV1", "x264", "H264", "AVC"… Bez zmínky null (neznámý).
function codecOfTitle(title) {
  const t = String(title || '');
  if (/(?:^|[^a-z0-9])av1(?![a-z0-9])/i.test(t)) return 3;
  if (/(?:^|[^a-z0-9])(?:[xh][.\s]?265|hevc|vp9)(?![a-z0-9])/i.test(t)) return 2;
  if (/(?:^|[^a-z0-9])(?:[xh][.\s]?264|avc)(?![a-z0-9])/i.test(t)) return 1;
  if (/(?:^|[^a-z0-9])(?:xvid|divx|mpeg-?2|vc-?1)(?![a-z0-9])/i.test(t)) return 0;
  return null;
}

// Hledaný formát položky: null = neřešit (výchozí), 'hevc' = aspoň H.265 (i AV1), 'av1' = jen AV1
const WANT_CODECS = { hevc: 2, av1: 3 };
const normWantCodec = (v) => (Object.hasOwn(WANT_CODECS, v) ? v : null);
const wantRank = (want) => WANT_CODECS[want] ?? null;
const wantCodecLabel = (want) => (want === 'av1' ? NAMES[3] : want === 'hevc' ? I18N.t('codec.want.hevc') : I18N.t('codec.want.none'));

module.exports = { NAMES, rankOfCodec, nameOf, codecOfTitle, WANT_CODECS, normWantCodec, wantRank, wantCodecLabel };
