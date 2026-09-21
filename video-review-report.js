/* Shared report formatting; pure functions also exercised by Node tests. */
((root) => {
  const sections = [
    ['professional_writeup', 'Hockey report'], ['summary', 'Overview'],
    ['tactical_report', 'Team tactics'], ['player_report', 'Player scouting'],
    ['patterns', 'Supported tendencies'], ['strengths', 'Strengths'],
    ['corrections', 'Next-game corrections'],
  ];
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const complete = job => job?.status === 'ready_for_review' && sections.every(([key]) =>
    typeof job.result?.game_rollup?.[key] === 'string' && job.result.game_rollup[key].trim());
  function coverage(job) {
    const chunks = job.result?.chunks || [];
    const steps = [...new Set(chunks.map(c => c.frame_step_seconds).filter(Number.isFinite))].sort((a,b) => a-b);
    const unknown = chunks.some(c => !Number.isFinite(c.frame_step_seconds));
    const closer = chunks.filter(c => c.sequence_review).length;
    return `Overview sampling: ${steps.length ? steps.join(' / ') + ' seconds' : 'not recorded'}${unknown && steps.length ? '; some older sections have unknown sampling' : ''}. ${closer} closer gameplay sequence${closer === 1 ? '' : 's'} at 2 frames/second. Sampled evidence; not continuous tracking. Human review required.`;
  }
  function evidenceText(c) {
    const r = c.review || {};
    const players = (r.player_evaluations || []).map(p => `${p.player} (${p.position || 'position unverified'}; ${p.confidence} confidence):\nStrengths: ${p.strengths}\nConcerns: ${p.concerns}\nHabits: ${p.habits}\nCoach note: ${p.coach_note}\nEvidence: ${(p.evidence_timestamps || []).map(clock).join(', ')}`).join('\n\n');
    return `${c.label} (${clock(c.start)}–${clock(c.end)})\n${r.summary || ''}\n${Object.entries(r.tactical || {}).map(([k,v]) => `${k.replaceAll('_',' ')}: ${v}`).join('\n')}\n${players}\n${(r.observations || []).map(o => `${clock(o.timestamp)} [${o.source}; needs review] ${o.player ? o.player + ': ' : ''}${o.note}`).join('\n')}\nUncertainties: ${(r.uncertainties || []).join(' ')}`;
  }
  function reportText(job) {
    if (!complete(job)) throw new Error('Wait for the complete scouting report before importing.');
    const rollup = job.result.game_rollup;
    return sections.map(([key,title]) => `${title.toUpperCase()}\n${rollup[key]}`).join('\n\n') +
      '\n\nEVIDENCE AND COVERAGE\n' + coverage(job) + '\n\n' +
      (job.result.chunks || []).map(c => evidenceText(c) + (c.sequence_review ? '\n\nCLOSER LOOK — SAME SEQUENCE\n' + evidenceText(c.sequence_review) : '')).join('\n\n');
  }
  function replaceBlock(existing, id, text) {
    const start = `[Video review ${id}]`, end = `[/Video review ${id}]`;
    const block = `${start}\n${text}\n${end}`;
    const a = existing.indexOf(start), b = a < 0 ? -1 : existing.indexOf(end, a);
    // Only replace bounded generated content. Never guess where legacy/manual notes end.
    if (a >= 0 && b >= 0) return existing.slice(0, a) + block + existing.slice(b + end.length);
    return [existing.trim(), block].filter(Boolean).join('\n\n');
  }
  function replayLink(value, seconds, offset = 0) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password) return '';
      if (['www.twitch.tv', 'twitch.tv'].includes(u.hostname)) {
        const match = u.pathname.match(/^\/(?:videos|v)\/(\d+)\/?$/) || u.pathname.match(/^\/[^/]+\/v\/(\d+)\/?$/);
        if (!match) return '';
        u.pathname = '/videos/' + match[1]; u.search = '';
      } else if (!['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname)) return '';
      u.searchParams.set('t', `${Math.floor(seconds + Number(offset || 0))}s`);
      return u.href;
    } catch { return ''; }
  }
  const api = { sections, clock, complete, coverage, evidenceText, reportText, replaceBlock, replayLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoReviewReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
