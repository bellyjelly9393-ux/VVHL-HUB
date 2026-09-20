(() => {
  if (window.WildmanUIPolishV3) return;
  window.WildmanUIPolishV3 = true;

  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const pageKinds = {
    'index.html':'home',
    'team.html':'team',
    'history.html':'team',
    'academy.html':'academy',
    'players.html':'directory',
    'esports-player.html':'player',
    'player-rusty.html':'player',
    'player-williamson20.html':'player',
    'player-williamson88.html':'player',
    'scouting-lab.html':'intelligence',
    'scouting.html':'intelligence',
    'vod-lab.html':'intelligence',
    'pro-series.html':'tournament',
    'events.html':'tournament',
    'event-format.html':'tournament',
    'caps-gaming.html':'tournament',
    'game-center.html':'live',
    'multiview.html':'live',
    'live-game.html':'live',
    'game.html':'live',
    'vod-center.html':'media',
    'wildman-media.html':'media',
    'media.html':'media',
    'reports.html':'media',
    'postgame.html':'media',
    'management.html':'management',
    'gm.html':'management',
    'admin.html':'management',
    'operator-assistant.html':'management',
    'tournament-control.html':'management',
    'postgame-desk.html':'management',
    'practice-night.html':'management',
    'hitmen-workspace.html':'management',
    'hitmen-management.html':'management',
    'hitmen-locker-room.html':'management',
    'hitmen-battle-plan.html':'management',
    'hitmen-card-vault.html':'management'
  };

  const hitmenPaths = new Set([
    'hitmen-workspace.html','hitmen-management.html','hitmen-locker-room.html',
    'hitmen-battle-plan.html','hitmen-card-vault.html'
  ]);

  function themeText(text){
    const t=String(text||'').toLowerCase();
    if(t.includes('calgary hitmen')||t.includes('hitmen')) return 'hitmen';
    if(t.includes('wildman academy')||t.includes('academy')) return 'academy';
    if(t.includes('wildman')) return 'wildman';
    return 'default';
  }

  function initials(name){
    const parts=String(name||'TEAM').trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return 'TM';
    return parts.map(x=>x[0]).join('').slice(0,3).toUpperCase();
  }

  function jersey(name){
    const clean=String(name||'').replace(/["<>]/g,'');
    return '<span class="wm-mini-jersey" data-team-theme="'+themeText(name)+'" title="'+clean+'">'+initials(name)+'</span>';
  }

  function applyPageIdentity(){
    const body=document.body;
    if(!body) return;
    const kind=pageKinds[path] || (body.classList.contains('management-protected') ? 'management' : 'network');
    body.classList.add('wm-ds','wm-page-'+kind);
    body.dataset.wmPage=kind;
    if(hitmenPaths.has(path) || body.classList.contains('hitmen-war-room') || body.classList.contains('hitmen-tool-page') || body.classList.contains('hitmen-management')){
      body.classList.add('wm-theme-hitmen');
    } else {
      body.classList.add('wm-theme-wildman');
    }

    if(kind==='player'){
      document.querySelector('.network-player-profile')?.classList.add('wm-player-dossier-head');
      const firstGrid=document.querySelector('main .wm-player-grid');
      if(firstGrid) firstGrid.classList.add('wm-player-dossier-grid');
    }
    if(kind==='academy') document.querySelector('.academy-membership')?.classList.add('wm-identity-hero');
    if(kind==='intelligence'){
      document.querySelector('.private-hero')?.classList.add('wm-identity-hero');
      document.querySelector('.vod-hero')?.classList.add('wm-identity-hero');
    }
    if(kind==='media') document.querySelector('.pro-hero')?.classList.add('wm-media-hero');
    if(kind==='tournament') document.querySelector('.pro-hero,.ops-hero')?.classList.add('wm-tournament-hero');
    if(kind==='live') document.querySelector('.ops-hero')?.classList.add('wm-live-hero');
  }

  function classifyCard(el){
    if(!el || el.classList.contains('wm-semantic-card')) return;
    const txt=((el.textContent||'')+' '+(el.getAttribute?.('href')||'')).toLowerCase();
    let type='';
    if(/scout|player intelligence|target|watchlist|evaluation/.test(txt)) type='scouting';
    else if(/vod|film|video|review/.test(txt)) type='vod';
    else if(/chemistry|line combination|teammate/.test(txt)) type='chemistry';
    else if(/value|valuation|salary|auction|bid|contract/.test(txt)) type='value';
    else if(/tournament|pro series|event|bracket|championship|cup/.test(txt)) type='tournament';
    else if(/media|report|recap|story|broadcast|news|postgame/.test(txt)) type='media';
    else if(/management|front office|operator|control room|war room|admin/.test(txt)) type='management';
    else if(/roster|lineup|locker|team|player directory/.test(txt)) type='roster';
    else if(/stat|leader|standing|analytics|data/.test(txt)) type='stats';
    else if(/live|stream|game center|multiview/.test(txt)) type='live';

    if(type){
      el.classList.add('wm-semantic-card','wm-card-'+type);
    }
    const wordCount=(el.textContent||'').trim().split(/\s+/).length;
    if(wordCount<14) el.classList.add('wm-card-compact');
  }

  function normalizeStatus(el){
    if(!el) return;
    const t=(el.textContent||'').trim().toLowerCase();
    if(!t) return;
    const map=[
      [/\blive\b/,'live'],
      [/upcoming|scheduled|next/,'upcoming'],
      [/completed|final|complete/,'completed'],
      [/processing|queued|reviewing|loading/,'processing'],
      [/\bscouted\b/,'scouted'],
      [/target|priority/,'target'],
      [/watchlist|watching/,'watchlist'],
      [/signed/,'signed'],
      [/rostered|active roster/,'rostered'],
      [/available|open/,'available']
    ];
    const hit=map.find(([re])=>re.test(t));
    if(hit) el.classList.add('wm-status','wm-status-'+hit[1]);
  }

  function upgradeTeamMarks(){
    document.querySelectorAll('.network-team-mark:not(.wm-jersey-upgraded)').forEach(el=>{
      el.classList.add('wm-jersey-upgraded');
      el.dataset.teamTheme=themeText(el.closest('a,article,div')?.textContent||'');
      el.setAttribute('title',(el.textContent||'Team').trim()+' jersey mark');
    });

    document.querySelectorAll('.game-row:not(.wm-matchup-upgraded)').forEach(row=>{
      const matchup=row.children?.[1]?.querySelector('strong');
      if(!matchup) return;
      const text=matchup.textContent||'';
      const bits=text.split(/\s+vs\s+/i);
      if(bits.length!==2) return;
      row.classList.add('wm-matchup-upgraded');
      const visual=document.createElement('div');
      visual.className='wm-matchup-visual';
      visual.innerHTML=jersey(bits[0])+'<span class="wm-mini-vs">VS</span>'+jersey(bits[1]);
      matchup.insertAdjacentElement('beforebegin',visual);
    });
  }

  function upgradeTabs(){
    document.querySelectorAll('.hub-tabs a:not(.wm-tab-upgraded)').forEach(a=>{
      a.classList.add('wm-tab-upgraded');
      const text=(a.textContent||'').toLowerCase();
      const icon=text.includes('live')?'●':
        text.includes('report')||text.includes('media')?'▤':
        text.includes('player')?'♟':
        text.includes('team')?'⌂':
        text.includes('vod')||text.includes('film')?'▶':
        text.includes('game')?'◆':
        text.includes('stat')?'▥':
        text.includes('scout')?'⌖':'›';
      a.insertAdjacentHTML('afterbegin','<span class="wm-tab-icon" aria-hidden="true">'+icon+'</span>');
    });
  }

  function upgradeLoading(){
    document.querySelectorAll('.empty-state:not(.wm-loading-checked)').forEach(el=>{
      el.classList.add('wm-loading-checked');
      if(/loading|checking|waiting|retrieving|syncing/i.test(el.textContent||'')) el.classList.add('wm-loading');
    });
  }

  function upgradeCards(){
    document.querySelectorAll([
      '.ops-card','.wm-card','.wm-feature-card','.network-team-card','.network-format-card',
      '.network-service','.academy-plan','.academy-paths>article','.academy-paths>details',
      '.academy-coaches>article','.report-card','.game-card','.vod-panel','.hitmen-panel',
      '.hm-command-card','.hm-tool-card'
    ].join(',')).forEach(classifyCard);
  }

  function upgradeStatuses(){
    document.querySelectorAll([
      '.status-pill','.scout-player-status','.game-status','.directory-pill',
      '[data-status-badge]','.live-refresh-note'
    ].join(',')).forEach(normalizeStatus);
  }

  function addSectionTexture(){
    document.querySelectorAll('.section-heading:not(.wm-heading-upgraded)').forEach(h=>{
      h.classList.add('wm-heading-upgraded');
      const parent=h.parentElement;
      const eyebrow=(h.querySelector('.eyebrow')?.textContent||'').toLowerCase();
      if(parent && /scout|intelligence|analysis|stats|leaderboard/.test(eyebrow)) parent.classList.add('wm-section-data');
      if(parent && /media|report|postgame|coverage/.test(eyebrow)) parent.classList.add('wm-section-media');
      if(parent && /match|game|tournament|event|standings/.test(eyebrow)) parent.classList.add('wm-section-competition');
      if(parent && /academy|training|development|coaching/.test(eyebrow)) parent.classList.add('wm-section-development');
    });
  }

  function enhance(){
    applyPageIdentity();
    upgradeTeamMarks();
    upgradeTabs();
    upgradeCards();
    upgradeStatuses();
    upgradeLoading();
    addSectionTexture();
  }

  const observer=new MutationObserver((mutations)=>{
    let shouldRun=false;
    for(const m of mutations){
      if(m.addedNodes?.length || m.type==='characterData'){shouldRun=true;break;}
    }
    if(shouldRun) requestAnimationFrame(enhance);
  });

  const start=()=>{
    enhance();
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();