/* Calgary Hitmen broadcast header: scoreboard (record, next game, countdown) + arena jumbotron.
   Shared by the War Room (hitmen-workspace.js hands it the schedule it already loaded) and the
   team locker (data-hb-autoload: one read-only SELECT on hitmen_schedule_games, same columns as the
   War Room; RLS decides who gets rows, an empty result shows the "Schedule TBA" empty state). */
(() => {
  const TEAM_ID = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const S = { schedule:[] };
  // Season record from hitmen_schedule_games: only final rows that carry both scores count.
  // W = Calgary scored more; OTL = lost in overtime; L = any other loss. 2 pts per W, 1 per OTL.
  function seasonRecord(rows){
    let w=0,l=0,otl=0,gf=0,ga=0;
    const finals=(rows||[]).filter(g=>g.status==='final'&&g.calgary_score!=null&&g.opponent_score!=null)
      .sort((a,b)=>String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    const results=finals.map(g=>{
      const cs=Number(g.calgary_score),os=Number(g.opponent_score);
      gf+=cs; ga+=os;
      if(cs>os){w++;return 'W';}
      if(g.overtime){otl++;return 'OT';}
      l++;return 'L';
    });
    let streak='';
    if(results.length){
      const last=results[results.length-1];let k=0;
      for(let i=results.length-1;i>=0&&results[i]===last;i--)k++;
      streak=`${last}${k}`;
    }
    return {w,l,otl,gp:w+l+otl,pts:w*2+otl,gf,ga,diff:gf-ga,streak};
  }

  // LGCHL S55 crest ids + abbreviations (same map as the live-ticker branch; crests in assets/lgchl/s55/).
  const LG_TEAMS = {
    'Calgary Hitmen':['CGY',412],'Baie-Comeau Drakkar':['BAC',469],'Barrie Colts':['BAR',449],'Brandon Wheat Kings':['BDN',409],
    'Brantford Bulldogs':['BFD',306],'Chicoutimi Saguenéens':['CHI',468],'Chilliwack Bruins':['CHW',2983],'Edmonton Oil Kings':['EDM',415],
    'Everett Silvertips':['EVT',380],'Flint Firebirds':['FLT',514],'Gatineau Olympiques':['GAT',461],'Kelowna Rockets':['KEL',400],
    'Kingston Frontenacs':['KGN',444],'Lethbridge Hurricanes':['LET',418],'London Knights':['LDN',370],'Medicine Hat Tigers':['MHT',416],
    'Moncton Wildcats':['MON',365],'Moose Jaw Warriors':['MJW',411],'Niagara IceDogs':['NIA',375],'North Bay Battalion':['NBB',448],
    "Ottawa 67's":['OTT',446],'Portland Winterhawks':['POR',398],'Prince Albert Raiders':['PAR',413],'Prince George Cougars':['PGC',422],
    'Red Deer Rebels':['RDR',385],'Regina Pats':['REG',414],'Saginaw Spirit':['SAG',408],'Saint John Sea Dogs':['SJS',397],
    'Sarnia Sting':['SAR',451],'Saskatoon Blades':['SAS',379],'Seattle Thunderbirds':['SEA',421],'Shawinigan Cataractes':['SHA',382],
    'Spokane Chiefs':['SPO',420],'Sudbury Wolves':['SBY',447],'Swift Current Broncos':['SCB',377],'Tri-City Americans':['TCA',399],
    "Val-d'Or Foreurs":['VDO',460],'Vancouver Giants':['VAN',386],'Victoria Royals':['VIC',419],'Windsor Spitfires':['WSR',381]
  };
  const ASSET_V = '20261004-broadcast';
  const teamAbbr = name => (LG_TEAMS[name]?.[0]) || String(name||'').split(/\s+/).filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase() || 'TBA';
  // Crest <img> with an abbreviation fallback if the file is missing or fails to load.
  function crestHtml(name){
    const id=LG_TEAMS[name]?.[1];
    const abbr=`<span class="bc-abbr">${esc(teamAbbr(name))}</span>`;
    return id?`<img src="assets/lgchl/s55/team${id}.png?v=${ASSET_V}" alt="" data-abbr="${esc(teamAbbr(name))}" decoding="async">`:abbr;
  }
  function wireCrestFallbacks(root){
    root?.querySelectorAll('img[data-abbr]').forEach(img=>{
      const swap=()=>{const sp=document.createElement('span');sp.className='bc-abbr';sp.textContent=img.dataset.abbr;img.replaceWith(sp);};
      if(img.complete&&img.naturalWidth===0) swap(); else img.addEventListener('error',swap,{once:true});
    });
  }
  // Time zones: LG schedule is ET; Calgary is MT.
  const ET='America/New_York', MT='America/Edmonton';
  const fmt = (d,tz,opts) => new Intl.DateTimeFormat('en-US',{timeZone:tz,...opts}).format(d);
  const etDateKey = d => fmt(d,ET,{year:'numeric',month:'2-digit',day:'2-digit'}); // MM/DD/YYYY
  const clock = (d,tz) => fmt(d,tz,{hour:'numeric',minute:'2-digit'});
  const dayLabel = d => fmt(d,ET,{weekday:'short'}).toUpperCase();
  const dateLabel = d => `${dayLabel(d)} ${fmt(d,ET,{month:'short'}).toUpperCase()} ${fmt(d,ET,{day:'numeric'})}`;

  function nextGame(rows,now=new Date()){
    return (rows||[]).filter(g=>g.status!=='final'&&g.status!=='cancelled'&&new Date(g.scheduled_at)>now)
      .sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0]||null;
  }
  function setText(id,v){const el=$(id); if(el) el.textContent=v;}
  let countdownTimer=null;
  function renderScoreboard(){
    if(!$('hitmenBroadcast')) return;
    // An official record (LG standings via the public feed) wins over the one counted from rows,
    // because LG schedule rows carry no OT flag.
    const rec=S.record||seasonRecord(S.schedule);
    const big=$('hitmenSbRecord');
    if(big){
      if(rec.gp){big.innerHTML=`<span>${rec.w}<small>W</small></span><i>&ndash;</i><span>${rec.l}<small>L</small></span><i>&ndash;</i><span>${rec.otl}<small>OTL</small></span>`;big.setAttribute('aria-label',`Season record ${rec.w} wins, ${rec.l} losses, ${rec.otl} overtime losses`);}
      else big.textContent='\u2014';
    }
    setText('hitmenSbPts',rec.gp?rec.pts:'\u2014');
    setText('hitmenSbGf',rec.gp?rec.gf:'\u2014');
    setText('hitmenSbGa',rec.gp?rec.ga:'\u2014');
    setText('hitmenSbDiff',rec.gp?(rec.diff>0?`+${rec.diff}`:rec.diff<0?`\u2212${Math.abs(rec.diff)}`:'0'):'\u2014');
    setText('hitmenSbStreak',rec.streak||'\u2014');
    renderNextGame();
  }
  function renderNextGame(){
    const now=new Date(), g=nextGame(S.schedule,now);
    const tag=$('hitmenSbNextTag'), crest=$('hitmenSbOppCrest');
    if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}
    if(!g){
      if(tag){tag.className='bc-k';tag.textContent='Next game';}
      setText('hitmenSbNextDate','\u2014'); setText('hitmenSbOppName','Schedule TBA'); setText('hitmenSbCountdown','--:--:--');
      if(crest) crest.innerHTML=''; if($('hitmenSbTimes')) $('hitmenSbTimes').innerHTML='&mdash; ET<br>&mdash; MT';
      setText('hitmenSbRailRight','Puck drop \u00b7 ET / MT');
      return;
    }
    const at=new Date(g.scheduled_at), tonight=etDateKey(at)===etDateKey(now);
    if(tag){tag.className=tonight?'bc-k bc-onair':'bc-k';tag.textContent=tonight?'Tonight':'Next game';}
    setText('hitmenSbNextDate',dateLabel(at));
    setText('hitmenSbOppName',g.opponent_name||'TBA');
    if(crest){crest.innerHTML=crestHtml(g.opponent_name);wireCrestFallbacks(crest);}
    if($('hitmenSbTimes')) $('hitmenSbTimes').innerHTML=`${esc(clock(at,ET))} ET<br>${esc(clock(at,MT))} MT`;
    const sameNight=S.schedule.filter(x=>x!==g&&x.status!=='final'&&etDateKey(new Date(x.scheduled_at))===etDateKey(at)&&new Date(x.scheduled_at)>at)
      .sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
    setText('hitmenSbRailLeft',`LGCHL \u00b7 Season 55${g.week?` \u00b7 Week ${g.week}`:''}`);
    setText('hitmenSbRailRight',sameNight.length?`Then ${sameNight.map(x=>`${teamAbbr(x.opponent_name)} ${clock(new Date(x.scheduled_at),ET).replace(/\s?[AP]M$/,'')}`).join(' \u00b7 ')} ET`:'Puck drop \u00b7 ET / MT');
    const tick=()=>{
      const ms=at-new Date();
      if(ms<=0){renderNextGame();return;}
      const t=Math.floor(ms/1000),d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60),sec=t%60,p=v=>String(v).padStart(2,'0');
      setText('hitmenSbCountdown',`${d?`${d}D `:''}${p(h)}:${p(m)}:${p(sec)}`);
    };
    tick(); countdownTimer=setInterval(tick,1000);
  }

  // Jumbotron: one game day at a time (Calgary plays 3 games each Sun, Mon and Tue).
  // The board day rolls over at 06:00 ET; on non-game days it shows the next game day.
  // Every game of that ET date (3 normally, 4 on some days; capped at 4 to fit the board), ordered by puck drop.
  // Finals show the score (winner bold).
  const JUMBO_MAX_GAMES = 4;
  const isoDay = d => { const [mm,dd,yy]=etDateKey(d).split('/'); return `${yy}-${mm}-${dd}`; };
  const boardDayKey = (now=new Date()) => isoDay(new Date(now.getTime()-6*3600*1000));
  function jumboGames(rows,now=new Date()){
    const from=boardDayKey(now);
    const games=(rows||[]).filter(g=>g.status!=='cancelled'&&g.scheduled_at).map(g=>({g,at:new Date(g.scheduled_at)}))
      .map(x=>({...x,day:isoDay(x.at)})).filter(x=>x.day>=from).sort((a,b)=>a.at-b.at);
    if(!games.length) return {day:null,games:[]};
    const day=games[0].day;
    return {day,games:games.filter(x=>x.day===day).slice(0,JUMBO_MAX_GAMES)};
  }
  let jumboKey='';
  function renderJumbotron(){
    const root=$('hitmenJumbo'), sr=$('hitmenJumboSr'); if(!root) return;
    jumboKey=boardDayKey();
    const {games}=jumboGames(S.schedule);
    root.classList.toggle('bc-jt-n4',games.length>3);
    if(!games.length){
      root.innerHTML='<div class="bc-jt-empty">Schedule TBA</div>';
      if(sr) sr.innerHTML='<li>Schedule TBA</li>';
      return;
    }
    const isFinal=g=>g.status==='final'&&g.calgary_score!=null&&g.opponent_score!=null;
    const mid=g=>{
      if(!isFinal(g)) return '<s>VS</s>';
      const c=Number(g.calgary_score),o=Number(g.opponent_score);
      return `<s class="bc-jt-final">${c>o?`<b>${c}</b>`:c}<em>&ndash;</em>${o>c?`<b>${o}</b>`:o}<small>FINAL${g.overtime?' OT':''}</small></s>`;
    };
    const label=dateLabel(games[0].at);
    root.innerHTML=`<div class="bc-jt-day">${esc(label)}</div>`+games.map(({g},i)=>`<div class="bc-jt-row"><i>GM ${i+1}</i><span class="bc-crest">${crestHtml('Calgary Hitmen')}</span>${mid(g)}<span class="bc-crest">${crestHtml(g.opponent_name)}</span></div>`).join('');
    wireCrestFallbacks(root);
    if(sr) sr.innerHTML=games.map(({g},i)=>`<li>${esc(label)}, game ${i+1}: Calgary Hitmen vs ${esc(g.opponent_name||'TBA')}${isFinal(g)?`, final ${Number(g.calgary_score)}-${Number(g.opponent_score)}${g.overtime?' OT':''}`:''}</li>`).join('');
  }
  setInterval(()=>{ if(jumboKey && boardDayKey()!==jumboKey) renderJumbotron(); },60000);

  // opts.record (optional): {w,l,otl,gp,pts,gf,ga,diff,streak} from the official LG standings line.
  function render(schedule,opts={}){ S.schedule=Array.isArray(schedule)?schedule:[]; S.record=opts.record||null; renderScoreboard(); renderJumbotron(); }
  window.HitmenBroadcast = { render, seasonRecord, teamAbbr, crestHtml };

  // Standalone pages (team locker): load the schedule once the page is unlocked for this account.
  let loadedFor = null;
  async function autoload(){
    const root=$('hitmenBroadcast'); if(!root||!root.hasAttribute('data-hb-autoload')) return;
    const db=window.VVHLBackend?.db, uid=window.VVHLBackend?.state?.user?.id;
    if(!db||!uid||loadedFor===uid) return;
    if(root.closest('[hidden]')) return; // page still locked for this account
    loadedFor=uid;
    const r=await db.from('hitmen_schedule_games').select('id,week,scheduled_at,opponent_name,calgary_side,status,calgary_score,opponent_score,overtime').eq('team_id',TEAM_ID).eq('season',55).order('scheduled_at');
    if(r.error) console.warn('hitmen_schedule_games unavailable',r.error);
    render(r.error?[]:(r.data||[]));
  }
  window.addEventListener('vvhl-auth-change',()=>setTimeout(autoload,0));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(autoload,0)); else setTimeout(autoload,0);
})();
