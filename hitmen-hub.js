(() => {
  'use strict';
  const TEAM = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const allowed = () => Boolean(window.VVHLManagementGuard?.hasAccess?.(auth()));
  let streams = [], replays = [], generation = 0, recorder, capture, downloadUrl;
  function message(text) { $('hh-status').textContent = text; }
  function media(raw, replay = false) {
    let u; try { u = new URL(raw); } catch { throw new Error('Enter a full Twitch or YouTube URL.'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Use an HTTPS video link.');
    const host = u.hostname.toLowerCase(), path = u.pathname.split('/').filter(Boolean);
    if (['twitch.tv','www.twitch.tv'].includes(host)) {
      const vod = u.pathname.match(/^\/(?:videos|v)\/(\d+)\/?$/) || u.pathname.match(/^\/[^/]+\/v\/(\d+)\/?$/);
      if (replay && !vod) throw new Error('Use the Twitch replay URL (twitch.tv/videos/…), not the live channel.');
      if (!vod && !(path.length === 1 && /^[a-zA-Z0-9_]+$/.test(path[0]))) throw new Error('Use a Twitch channel or full replay link.');
      return {provider:'twitch', url:vod ? `https://www.twitch.tv/videos/${vod[1]}` : u.href, embed:`https://player.twitch.tv/?${vod ? 'video='+vod[1] : 'channel='+encodeURIComponent(path[0])}&parent=${encodeURIComponent(location.hostname)}&autoplay=false`};
    }
    if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? path[0] : u.searchParams.get('v') || (['live','embed','shorts'].includes(path[0]) ? path[1] : '');
      if (!/^[\w-]{11}$/.test(id || '')) throw new Error('Use a specific YouTube video or broadcast link.');
      return {provider:'youtube',url:`https://www.youtube.com/watch?v=${id}`,embed:`https://www.youtube.com/embed/${id}`};
    }
    throw new Error('This player supports Twitch and YouTube. Use VOD Lab to upload other recordings.');
  }
  function watch(title, url, replay = false) {
    if (!allowed()) return;
    try {
      const m = media(url, replay);
      $('hh-watch-title').textContent = title;
      const frame = document.createElement('iframe'); frame.src = m.embed; frame.title = title; frame.allow = 'fullscreen; picture-in-picture'; frame.allowFullscreen = true;
      $('hh-player').replaceChildren(frame);
      $('hh-source').innerHTML = `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Open on ${esc(m.provider)} ↗</a> · If playback is unavailable here, open the source.`;
      $('hh-player').scrollIntoView({behavior:'smooth',block:'center'});
    } catch (e) { message(e.message); }
  }
  const date = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'Date not set';
  function render() {
    $('hh-streams').innerHTML = streams.length ? streams.map((s,i) => `<article class="hh-item"><h3>${esc(s.opponent_label ? 'Calgary vs '+s.opponent_label : s.label)}</h3><p>${esc(date(s.scheduled_at))} · ${esc(s.status)} · Stream link saved</p><button type="button" data-stream="${i}">Watch stream</button></article>`).join('') : '<p>No game streams saved yet. Add the broadcast link below.</p>';
    const term = $('hh-search').value.toLowerCase();
    const rows = replays.map((r,i) => ({r,i})).filter(({r}) => `${r.title} ${r.opponent_label||''}`.toLowerCase().includes(term));
    $('hh-replays').innerHTML = rows.length ? rows.map(({r,i}) => `<article class="hh-item"><h3>${esc(r.title)}</h3><p>${esc(date(r.game_date))} · ${esc(r.status)}${r.mux_status ? ' · Upload: '+esc(r.mux_status) : ''}</p>${r.vod_url ? `<button type="button" data-replay="${i}">Watch replay</button> ` : ''}<a href="vod-lab.html?team=calgary-hitmen&review=${encodeURIComponent(r.id)}">Open film review →</a></article>`).join('') : `<p>${term ? 'No matching recordings.' : 'No saved replays yet. Add a replay link or upload in VOD Lab.'}</p>`;
  }
  async function load() {
    const request = ++generation;
    if (!allowed()) { streams=[]; replays=[]; $('hh-player').replaceChildren(); $('hh-source').textContent=''; render(); return; }
    message('Loading Hitmen games…');
    try {
      const results = await Promise.all([
        db().from('team_competitive_sessions').select('id,label,opponent_label,scheduled_at,status,stream_url').eq('team_id',TEAM).not('stream_url','is',null).order('scheduled_at',{ascending:false,nullsFirst:false}).limit(60),
        db().from('vod_review_sessions').select('id,title,opponent_label,game_date,status,vod_url,mux_status').eq('team_id',TEAM).neq('status','archived').order('game_date',{ascending:false}).limit(100)
      ]);
      if (request !== generation || !allowed()) return;
      const error = results.find(r=>r.error)?.error; if(error) throw error;
      streams=results[0].data||[]; replays=results[1].data||[]; render(); message('Hitmen streams and recordings are up to date.');
    } catch (e) { if(request === generation) message('Could not load games: '+e.message+' Use Refresh to retry.'); }
  }
  async function save(event, replay) {
    event.preventDefault(); if(!allowed()) return message('Sign in with your Hitmen management account.');
    const form=event.currentTarget, button=form.querySelector('button[type="submit"]'); if(button.disabled) return;
    try {
      const values=new FormData(form), m=media(values.get('url').trim(),replay), when=new Date(values.get('date'));
      if(!Number.isFinite(when.getTime())) throw new Error('Choose a valid game time.');
      button.disabled=true; message('Saving…');
      const opponent=values.get('opponent').trim(); if(!opponent) throw new Error('Enter the opponent.');
      const common={team_id:TEAM,opponent_label:opponent,created_by:auth().user.id};
      const payload=replay ? {...common,title:values.get('title').trim(),vod_url:m.url,source_provider:m.provider,game_date:when.toISOString(),game_type:'regular',intake_mode:'archive',status:'queued'} : {...common,label:'Calgary vs '+opponent,season_label:'LGCHL S55',session_type:'regular',best_of:1,scheduled_at:when.toISOString(),stream_url:m.url,status:'scheduled'};
      const result=await db().from(replay?'vod_review_sessions':'team_competitive_sessions').insert(payload).select('id').single();
      if(result.error) throw result.error;
      form.reset(); await load(); message(replay?'Replay saved to the Hitmen archive.':'Game stream saved. Broadcast from your console or streaming software.');
    } catch(e) { message(e.message || 'Save failed. Please try again.'); } finally { button.disabled=false; }
  }
  document.addEventListener('click',e=>{
    const stream=e.target.closest('[data-stream]'), replay=e.target.closest('[data-replay]');
    if(stream){const s=streams[Number(stream.dataset.stream)];if(s)watch(s.label,s.stream_url);}
    if(replay){const r=replays[Number(replay.dataset.replay)];if(r)watch(r.title,r.vod_url,true);}
  });
  $('hh-stream-form').addEventListener('submit',e=>save(e,false));
  $('hh-replay-form').addEventListener('submit',e=>save(e,true));
  $('hh-search').addEventListener('input',render); $('hh-refresh').addEventListener('click',load);
  $('hh-record').disabled = !navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder;
  if($('hh-record').disabled) $('hh-record-status').textContent='Screen recording needs a supported desktop browser. On console or mobile, save your broadcast replay and add its link above.';
  $('hh-record').addEventListener('click',async()=>{
    if(!allowed()) return;
    $('hh-record').disabled=true;
    try {
      capture=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      if(!allowed()){capture.getTracks().forEach(t=>t.stop());return;}
      const type=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      recorder=new MediaRecorder(capture,type?{mimeType:type}:{}); const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{
        capture.getTracks().forEach(t=>t.stop());
        if(downloadUrl) URL.revokeObjectURL(downloadUrl);
        downloadUrl=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));
        const a=$('hh-download');a.href=downloadUrl;a.download=`hitmen-${new Date().toISOString().replace(/[:.]/g,'-')}.${recorder.mimeType.includes('mp4')?'mp4':'webm'}`;a.hidden=false;
        $('hh-stop').disabled=true;$('hh-record').disabled=false;$('hh-record-status').textContent='Recording stopped. Download the file before leaving, then upload it in VOD Lab.';
      };
      recorder.onerror=()=>{$('hh-record-status').textContent='Recording failed. Stop and download any captured footage.';};
      capture.getVideoTracks()[0].onended=()=>{if(recorder.state!=='inactive')recorder.stop();};
      recorder.start(1000);$('hh-stop').disabled=false;$('hh-download').hidden=true;
      $('hh-record-status').textContent='Recording now'+(capture.getAudioTracks().length?' with audio.':' without audio. Stop and choose a tab with audio if you need sound.')+' Keep this page open; stop after each game.';
    } catch(e){capture?.getTracks().forEach(t=>t.stop());$('hh-record').disabled=false;$('hh-record-status').textContent='Recording did not start: '+e.message;}
  });
  $('hh-stop').addEventListener('click',()=>{if(recorder?.state==='recording')recorder.stop();});
  window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'||downloadUrl){e.preventDefault();e.returnValue='';}});
  window.addEventListener('vvhl-auth-change',()=>{if(!allowed()&&recorder?.state==='recording')recorder.stop();load();});
  load();
})();
