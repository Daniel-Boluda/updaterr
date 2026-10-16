// Společné ovládání stahování a slučování: kdo je zrovna "zaneprázdněný" a schválení kandidáta.
const { proposalKeys, resolveCandidate } = require('./search');
const { t } = require('./i18n');

function attachJobs(ctx) {
  const { store } = ctx;

  // Návrhy, které se právě schvalují (ověření seedů může trvat i minuty) – brání dvojímu stažení
  ctx.inflight = new Set();

  // Položky, pro které právě běží (nebo se spouští) stahování, slučování či oprava synchronizace.
  // `except` = návrh, který se právě schvaluje – jeho vlastní položky se za rozpracované nepočítají.
  ctx.busyKeys = ({ except = null } = {}) => new Set([
    ...ctx.downloads.active().flatMap((d) => d.itemKeys || [d.itemKey]),
    ...ctx.merger.active().map((j) => j.itemKey),
    ...(ctx.dubsync ? ctx.dubsync.active().map((j) => j.itemKey) : []),
    ...[...ctx.inflight].filter((id) => id !== except).flatMap((id) => (store.s.proposals[id] ? proposalKeys(store.s.proposals[id]) : [])),
  ]);

  // Schválení kandidáta (web, Telegram, ntfy, automatika): sloučení stop, nebo výměna celého souboru.
  // `ref` je ID kandidáta (stabilní i po přehledání), interně případně pořadí.
  ctx.grab = async (proposalId, ref, opts) => {
    const p = store.s.proposals[proposalId];
    if (!p) throw Object.assign(new Error(t('err.proposalNotFound')), { status: 404 });
    const idx = resolveCandidate(p, ref);
    if (idx < 0) throw new Error(t('err.candidateGone'));
    if (ctx.inflight.has(proposalId)) throw new Error(t('err.proposalInflight'));
    ctx.inflight.add(proposalId);
    try {
      const cand = p.candidates[idx];
      const job = cand.kind === 'merge' ? await ctx.merger.start(proposalId, idx, opts) : await ctx.downloads.grab(proposalId, idx, opts);
      p.grabbedGuid = cand.guid;
      return job;
    } finally {
      ctx.inflight.delete(proposalId);
    }
  };
  return ctx;
}

module.exports = { attachJobs };
