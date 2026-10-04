/* Lineup Lab: one room, three separate panels (Tonight's Six · Lineup Sandbox · Simulate Tonight).
   - Panel 1 is war-room-tonight.js's Tonight's Six component (mounted into #labSix there).
   - Panels share ONE object, the lineup (createLineup below). Nothing else crosses between panels.
   - Read-only: every query is a SELECT the viewer's RLS already allows. Sandbox lineups save to
     localStorage on this device only. The Battle Plan "game sheet" is shown read-only; saving stays in
     hitmen-battle-plan.html (management only, unchanged).
   - Team-config driven (TEAMS below) so the same room can be mounted for another team later.
   Model: lineup-lab-model.js (Sandbox Chemistry v0 + matchup v0, both PLACEHOLDERS).            */
(function(){
'use strict';
const TEAMS={
  calgary:{key:'calgary',teamId:'b0bcbdda-da9d-419d-8f61-b34937966d49',season:55,league:'LGCHL',seasonLabel:'S55',lgTeamId:412,
    name:'Calgary Hitmen',nick:'Hitmen',abbr:'CGY',activeClass:'active_roster',
    mgmtRoles:['owner','gm','agm','scout'],manageRoles:['owner','gm','agm'],
    editors:{battlePlan:'hitmen-battle-plan.html',lineups:'hitmen-locker-room.html'}}
};
const POS=['LW','C','RW','LD','RD','G'],SK=['LW','C','RW','LD','RD'];
const POS_LONG={LW:'Left wing',C:'Centre',RW:'Right wing',LD:'Left defence',RD:'Right defence',G:'Goalie'};
const DB=()=>window.VVHLBackend?.db, ST=()=>window.VVHLBackend?.state||{}, M=()=>window.LabModel, TN=()=>window.WRTonight;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lc=s=>String(s||'').trim().toLowerCase();
const f1=v=>v==null||!Number.isFinite(+v)?'–':(+v).toFixed(1), f2=v=>v==null||!Number.isFinite(+v)?'–':(+v).toFixed(2);
const sgn=v=>(v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(2);
const pct=v=>v==null?'–':(+v).toFixed(1)+'%', sv3=v=>v==null?'–':(+v).toFixed(3).replace(/^0/,'');
const CONF_N={Projected:0,Low:1,Medium:2,High:3};
const confChip=(c,extra)=>`<span class="lab-conf" data-n="${CONF_N[c]??0}" title="Confidence: ${esc(c)}${extra?' · '+esc(extra):''}"><i></i><i></i><i></i><b>${esc(c)}</b>${extra?`<small>${esc(extra)}</small>`:''}</span>`;
const PLACEHOLDER='v0 placeholder';

function viewer(cfg){
  const s=ST(),pr=String(s.profile?.role||'').toLowerCase();
  const m=(s.memberships||[]).find(x=>x.team_id===cfg.teamId&&x.active!==false);
  const role=pr==='admin'?'admin':String(m?.role||'').toLowerCase();
  return {user:s.user||null,role,mgmt:role==='admin'||cfg.mgmtRoles.includes(role),manage:role==='admin'||cfg.manageRoles.includes(role)};
}

/* ---------- the one shared lineup object ---------- */
function createLineup(){
  const blank=()=>Object.fromEntries(POS.map(p=>[p,null]));
  const st={tonight:{gm:null,gameId:null,kit:'home',six:null,approved:false},sandbox:blank()};
  const subs=[];
  const api={
    get:()=>JSON.parse(JSON.stringify(st)),
    setTonight(t){st.tonight={gm:t?.gm??null,gameId:t?.gameId??null,kit:t?.game?.kit||'home',six:t?.six?Object.assign({},t.six):null,approved:!!t?.approved};emit('tonight')},
    setSandbox(slots){POS.forEach(p=>{st.sandbox[p]=slots&&slots[p]||null});emit('sandbox')},
    on(f){subs.push(f)}
  };
  function emit(kind){const snap=api.get();subs.forEach(f=>{try{f(kind,snap)}catch(e){console.error('[lineup-lab]',e)}})}
  return api;
}

/* ---------- data (SELECT only) ---------- */
const LGSEL='gamertag,position,games_played,lg_team_id,season,g:stats->goals,a:stats->assists,s:stats->shots,h:stats->hits,tk:stats->takeaway,gv:stats->giveaway,ic:stats->interceptions,bs:stats->bs,fop:stats->fop,passp:stats->passp,gf:stats->team_gf,ga:stats->team_ga,rec:stats->record,svp:stats->savep,gaa:stats->gaa,sog:stats->sog,gag:stats->ga';
const orQuote=t=>'"'+String(t).replace(/["\\]/g,'\\$&')+'"';
async function loadLab(cfg,v,D){
  const db=DB(),errors=[];
  const ok=r=>{if(r&&r.error)errors.push(r.error.message||String(r.error));return (r&&r.data)||[]};
  const [lr,gr]=await Promise.all([
    db.from('team_player_lockers').select('id,user_id,gamertag,jersey_number,jersey_name,position,secondary_position,roster_class,management_role').eq('team_id',cfg.teamId).eq('season',cfg.season),
    db.from('team_player_game_reports').select('schedule_game_id,locker_id,position_played,stats,ea_match_id:evidence->>ea_match_id,created_at,visibility').eq('team_id',cfg.teamId).eq('season',cfg.season)
  ]);
  // league season lines (public to signed-in users): baselines + our current-season lines
  let lgSeason=[];
  for(let from=0;from<6000;from+=1000){
    const page=ok(await db.from('lg_player_season_stats').select(LGSEL).eq('league_code',cfg.league).eq('season',cfg.season).eq('season_type','regular').order('id').range(from,from+999));
    lgSeason=lgSeason.concat(page); if(page.length<1000) break;
  }
  const lockers=ok(lr), active=lockers.filter(l=>l.roster_class===cfg.activeClass);
  const tags=[...new Set(lockers.map(l=>l.gamertag).filter(Boolean))];
  // career prior (out-of-sample): the same league's earlier regular seasons for our players
  let career=[];
  if(tags.length){
    const rows=ok(await db.from('lg_player_season_stats').select(LGSEL).eq('league_code',cfg.league).eq('season_type','regular').lt('season',cfg.season).gt('season',0)
      .or(tags.map(t=>'gamertag.ilike.'+orQuote(t)).join(',')).limit(1000));
    const want=new Set(tags.map(lc)); career=rows.filter(r=>want.has(lc(r.gamertag)));
  }
  const games=D?.games||[];
  const oppNames=[...new Set(games.filter(g=>g.report&&g.report.opp.length).map(g=>g.name))];
  const opp=oppNames.length?ok(await db.from('hitmen_opponent_player_stats').select('opponent_name,gamertag,position,source,games_played,wins,losses,goals,assists,shots,hits,takeaways,giveaways,faceoff_pct,passing_pct,goalie_save_pct,goalie_gaa,raw_stats')
      .eq('team_id',cfg.teamId).eq('season',cfg.season).in('opponent_name',oppNames)):[];
  // game sheet (Battle Plan rows): management only, read-only here
  const plans=v.mgmt&&games.length?ok(await db.from('hitmen_battle_plans').select('id,schedule_game_id,opponent_name,game_date,status,danger_players,tendencies,keys_to_win,matchup_assignments,reminders,management_notes,updated_at')
      .eq('team_id',cfg.teamId).in('schedule_game_id',games.map(g=>g.id))):[];
  // RLS: management reads every box score. A player reads team-visible rows plus only their own, which
  // would bias "games together", so the player view uses team-visible rows only (else career projection).
  let reports=ok(gr);
  const shared=v.mgmt?reports.length>0:(reports=reports.filter(r=>r.visibility==='team')).length>0;
  return {lockers,active,reports,shared,lgSeason,career,opp,plans,errors};
}

/* ---------- helpers on loaded data ---------- */
function makeHelpers(cfg,v,D,L){
  const m=M();
  const ctx=m.createContext({schedule:D?.schedule||[],reports:L.reports,lockers:L.lockers,lgSeason:L.lgSeason,lgCareer:L.career,shared:L.shared});
  const byId=new Map(L.lockers.map(l=>[l.id,l]));
  const name=id=>byId.get(id)?.gamertag||'—';
  const lockerByTag=t=>L.lockers.find(l=>lc(l.gamertag)===lc(t))||null;
  const lgByTag=new Map();L.lgSeason.forEach(r=>{const k=lc(r.gamertag);if(!lgByTag.has(k))lgByTag.set(k,[]);lgByTag.get(k).push(r)});
  // games with a missing position row (e.g. the Sept 30 private-log games have no RD row)
  const gapGames=[];
  if(L.shared){const by=new Map();ctx.base.forEach(r=>{if(!by.has(r.gid))by.set(r.gid,new Set());by.get(r.gid).add(r.pos)});
    by.forEach((ps,gid)=>{const miss=SK.filter(p=>!ps.has(p));if(miss.length)gapGames.push({gid,miss})});}
  function fit(id,slot){
    const l=byId.get(id); if(!l) return {k:'off',t:'Unknown'};
    const p=String(l.position||'').toUpperCase(),s2=String(l.secondary_position||'').toUpperCase();
    if(slot==='G') return p==='G'?{k:'pri',t:'Primary'}:{k:'off',t:'Not a goalie'};
    if(p==='G') return {k:'off',t:'Goalie in a skater slot'};
    if(p===slot) return {k:'pri',t:'Primary'};
    if(s2===slot) return {k:'sec',t:'Secondary'};
    const h=ctx.slotGP(id,slot); if(h.s55||h.career) return {k:'his',t:`Played here · ${h.s55+h.career} GP`};
    return {k:'off',t:`Off-position · ${p||'?'}`};
  }
  const chemCache=new Map();
  function chem(six){const key=SK.map(p=>six[p]||'-').join('|');if(!chemCache.has(key))chemCache.set(key,m.sixChemistry(ctx,six));return chemCache.get(key)}
  // current-season line for the matchup model: LG season totals (public), falling back to our box scores
  function ourLine(id,slot){
    const l=byId.get(id); if(!l) return null;
    const rows=lgByTag.get(lc(l.gamertag))||[];let x=null;
    if(rows.length){const t={gp:0,g:0,a:0,s:0,h:0,tk:0,int:0,bs:0,gv:0,sog:0,ga:0,fopW:0,fopN:0,passW:0,passN:0,svW:0,svN:0};
      rows.forEach(r=>{const gp=+r.games_played||0;t.gp+=gp;['g','a','s','h','tk','gv','bs'].forEach(k=>t[k]+=+r[k]||0);t.int+=+r.ic||0;t.sog+=+r.sog||0;
        if(r.fop!=null){t.fopW+=+r.fop*gp;t.fopN+=gp}if(r.passp!=null){t.passW+=+r.passp*gp;t.passN+=gp}if(r.svp!=null){t.svW+=(+r.svp>1?+r.svp/100:+r.svp)*(+r.sog||gp);t.svN+=(+r.sog||gp)}});
      x={gp:t.gp,g:t.g,a:t.a,s:t.s,h:t.h,tk:t.tk,int:t.int,bs:t.bs,gv:t.gv,fop:t.fopN?t.fopW/t.fopN:null,pass:t.passN?t.passW/t.passN:null,svp:t.svN?t.svW/t.svN:null,sog:t.sog,src:`${cfg.league} ${cfg.seasonLabel}`};
    } else if(L.shared){const b=ctx.playerBase(id);if(b.gp)x={gp:b.gp,g:b.g,a:b.a,s:b.s,h:b.hits,tk:b.tk,int:b.int,bs:0,gv:b.gv,fop:null,pass:null,svp:null,sog:0,src:'box scores'}}
    if(!x) x={gp:0,src:'no data'};
    x.name=l.gamertag;x.names=[lc(l.gamertag)];
    if(slot==='C'){const fo=ctx.faceoffs(id);if(fo){x.fop=100*fo.w/Math.max(1,fo.w+fo.l);x.draws=fo.w+fo.l;x.fow=fo.w;x.fol=fo.l;x.drawsEst=false}else{x.draws=x.fop!=null?20*x.gp:0;x.drawsEst=x.fop!=null}}
    if(slot==='G'&&x.svp==null){const gb=ctx.goalieBase(id);if(gb&&gb.sf){x.svp=gb.sv/gb.sf;x.sog=gb.sf;x.src='box scores'}}
    return x;
  }
  function theirLine(g,raw,slot){
    const r=g.report, mm=String(raw||'').match(/^(.*?)\s*\((.+)\)\s*$/);
    const names=[lc(mm?mm[1]:raw)];if(mm)names.push(...mm[2].split(/[,/]/).map(lc));
    (r.resolutions||[]).forEach(x=>{const all=[x.gamertag,...(x.aliases||[])].map(lc);if(all.some(n=>names.includes(n)))names.push(...all)});
    const rows=L.opp.filter(o=>o.opponent_name===g.name&&names.includes(lc(o.gamertag)));
    const row=rows.find(o=>o.source==='lg_chl')||rows.find(o=>o.source==='ea_nhl27');
    const disp=mm?mm[1]:raw;
    if(!row) return {gp:0,name:disp,names,src:'not found',missing:true};
    const rs=row.raw_stats||{},sv=row.goalie_save_pct!=null?+row.goalie_save_pct:(rs.savep!=null?+rs.savep:null);
    const x={gp:+row.games_played||0,g:+row.goals||0,a:+row.assists||0,s:+row.shots||0,h:+row.hits||0,tk:+row.takeaways||0,gv:+row.giveaways||0,
      int:+(rs.interceptions??0)||0,bs:+(rs.bs??rs.skbs??0)||0,fop:row.faceoff_pct!=null?+row.faceoff_pct:(rs.fop!=null?+rs.fop:null),pass:row.passing_pct!=null?+row.passing_pct:null,
      svp:sv==null?null:(sv>1?sv/100:sv),sog:+(rs.sog??0)||0,name:disp,names,src:row.source==='lg_chl'?`${cfg.league} ${cfg.seasonLabel}`:'EA career'};
    if(slot==='C'){x.draws=x.fop!=null?20*x.gp:0;x.drawsEst=true}
    if(slot==='G'&&!x.sog&&x.svp!=null)x.sog=Math.round(15*x.gp);
    return x;
  }
  // league shot volume by team (top third = Risky trigger for a weak goalie)
  const teamShots=(()=>{const t=new Map();L.lgSeason.forEach(r=>{if(String(r.position).toUpperCase()==='G'||!r.lg_team_id)return;const o=t.get(r.lg_team_id)||{s:0,gp:0};o.s+=+r.s||0;o.gp=Math.max(o.gp,+r.games_played||0);t.set(r.lg_team_id,o)});
    const arr=[...t].map(([id,o])=>({id,spg:o.gp?o.s/o.gp:0})).sort((a,b)=>b.spg-a.spg);return {rank:id=>arr.findIndex(x=>x.id===id)+1,n:arr.length}})();
  function simulate(six,g){
    const r=g.report,us={},them={};
    POS.forEach(p=>{us[p]=six[p]?ourLine(six[p],p):null;them[p]=r.opp.find(o=>o.pos===p)?theirLine(g,(r.opp.find(o=>o.pos===p).name+(r.opp.find(o=>o.pos===p).note?` (${r.opp.find(o=>o.pos===p).note})`:'')),p):null});
    const c=chem(six);
    const threatNames=[lc(r.threatText||''),...(r.threats||[]).map(lc)];
    const lanes=m.lanes(ctx,us,them,{chem:c,threatNames});
    const rk=g.lg?teamShots.rank(g.lg):0, top=rk>0&&rk<=Math.ceil(teamShots.n/3);
    const vd=m.verdict(lanes,{topThirdShots:top});
    const gps=POS.flatMap(p=>[us[p]?.gp||0,them[p]?.gp||0]);
    const conf=m.matchupConfidence({gps,warnings:(r.warnings||[]).length>0,approved:r.approved,resolved:POS.every(p=>them[p]&&!them[p].missing)});
    return {us,them,chem:c,lanes,vd,conf,topShots:top,shotRank:rk};
  }
  function bestSwap(six,g,base){
    let best=null;
    POS.forEach(p=>{L.active.forEach(l=>{if(Object.values(six).includes(l.id))return;const f=fit(l.id,p);if(f.k==='off')return;
      const t=Object.assign({},six,{[p]:l.id});const s=simulate(t,g);const d=s.vd.T-base.vd.T;
      if(d>=0.10&&s.vd.verdict!=='Risky'&&s.vd.threat.length<=base.vd.threat.length&&(!best||d>best.d))best={p,id:l.id,out:six[p],d,s}})});
    return best;
  }
  return {ctx,byId,name,lockerByTag,fit,chem,simulate,bestSwap,gapGames};
}

/* ---------- local saves (this device only) ---------- */
const storeKey=(cfg,v)=>`vvhl.lineupLab.${cfg.key}.s${cfg.season}.${v.user?.id||'anon'}`;
const readStore=(cfg,v)=>{try{return JSON.parse(localStorage.getItem(storeKey(cfg,v))||'{}')||{}}catch(e){return {}}};
const writeStore=(cfg,v,o)=>{try{localStorage.setItem(storeKey(cfg,v),JSON.stringify(o));return true}catch(e){return false}};

/* ---------- panel header ---------- */
const panelHead=(n,kicker,title,id,right)=>`<header class="lab-ph"><span class="lab-no">${n}</span><div><span class="wr-k">${kicker}</span><h3 id="${id}">${title}</h3></div><div class="lab-ph-r">${right||''}</div></header><hr class="lab-div">`;

/* ---------- link rows ---------- */
function linkRow(H,x){
  const pr=x.source==='projected';
  const detail=pr?`Projected · ${esc(x.priorNote)}`:`${x.confidence} · ${x.G} GP together · ${x.W}-${x.L} · GD ${x.gdPg>=0?'+':'−'}${Math.abs(x.gdPg).toFixed(2)}/g · ${x.ptsPg.toFixed(1)} pts/g · shrink ${x.shrink} toward ${x.prior}`;
  const tags=x.tags.filter(Boolean).join(' / ');
  return `<li class="${pr?'proj':''}"><span class="lab-lk">${x.sa}–${x.sb}</span><b>${esc(H.name(x.a))} <i>+</i> ${esc(H.name(x.b))}</b><em>${x.score}</em>${confChip(x.confidence)}<small>${detail}${tags?' · '+esc(tags):''}</small></li>`;
}
function chemHTML(H,c,L,v){
  if(!c.complete) return `<div class="lab-chem lab-chem-empty"><span class="wr-k">Starter chemistry, based on games played together</span><p>Fill ${c.missing.map(p=>`<b>${p}</b>`).join(', ')} to score this six. The goalie is not part of chemistry; it counts in Simulate Tonight.</p></div>`;
  const bar=(k,lbl,val,w)=>`<div class="lab-bar"><span>${lbl}<small>${w}</small></span><i style="--w:${val}%"></i><b>${val}</b></div>`;
  const note=L.shared?`Box scores: ${H.ctx.gamesWithBox} games, one row per player per game (EA match rows preferred).${H.gapGames.length?` ${H.gapGames.length} game${H.gapGames.length>1?'s are':' is'} missing a ${[...new Set(H.gapGames.flatMap(g=>g.miss))].join('/')} row, so those pairs are unknown there.`:''}`
    :`Teammates' box scores aren't visible in the player view, so every link here is a career projection (Projected) from ${esc(L.lgSeason.length?'LG season stats':'no data')}.`;
  return `<div class="lab-chem">
    <div class="lab-chem-top"><div><span class="wr-k">Starter chemistry, based on games played together</span><div class="lab-big"><b>${c.score}</b><span>${esc(c.label)}</span></div></div>${confChip(c.confidence,c.unit.G?`${c.unit.G} GP as this five`:c.medianG?`median ${c.medianG} GP per link`:'no games together')}</div>
    <div class="lab-bars">${bar('f','Forward triangle',c.parts.forwards,'35%')}${bar('d','D pair',c.parts.dPair,'20%')}${bar('b','Bridges (F–D)',c.parts.bridges,'25%')}${bar('u','Unit (exact five)',c.parts.unit,'20%')}</div>
    <ol class="lab-links">${[...c.links.forwards,c.links.dPair,...c.links.bridges].map(x=>linkRow(H,x)).join('')}</ol>
    <p class="wr-note"><b>${PLACEHOLDER}.</b> Pair = win 30 · goal diff 20 · production 30 · style 20, shrunk toward an out-of-sample prior (games apart or career, else 50; −10 off-position) by G/(G+3). Six = 0.35 forwards + 0.20 D pair + 0.25 bridges + 0.20 exact-five unit. Dashed links have no games together. ${note}</p>
  </div>`;
}

/* ---------- panel 2: sandbox ---------- */
function mountSandbox(host,cfg,v,D,L,H,lineup){
  const st={slots:Object.fromEntries(POS.map(p=>[p,null])),selP:null,selS:null,msg:''};
  const store=readStore(cfg,v);
  if(store.draft) POS.forEach(p=>{const id=store.draft[p];st.slots[p]=id&&L.active.some(l=>l.id===id)?id:null});
  let tonight=lineup.get().tonight;
  host.innerHTML=panelHead(2,'Try your own · saves on this device only','Lineup Sandbox','labSbTitle',`<span id="labSbConf"></span>`)+
   `<div class="lab-sb">
     <div class="lab-sb-l">
       <div class="lab-tools" role="toolbar" aria-label="Sandbox tools">
         <button type="button" class="wr-btn" data-act="tonight"></button>
         <button type="button" class="wr-btn" data-act="clear">Clear</button>
         <button type="button" class="wr-btn" data-act="save">Save on this device</button>
       </div>
       <div class="lab-sel" id="labSel" aria-live="polite"></div>
       <div class="wr-rink-host lab-rink-host"><div id="labSbRink"></div></div>
       <div class="lab-saved" id="labSaved"></div>
     </div>
     <div class="lab-sb-r" id="labChem"></div>
   </div>
   <div class="lab-bench" id="labBench" aria-label="Active roster"></div>
   <p class="wr-note">Tap a player, then a slot (or drag a player onto a slot). Tap two slots to swap them. Only the ${L.active.length} active-roster players are listed; archived past players never appear. Position fit compares the slot with each player's primary and secondary position in <code>team_player_lockers</code> and any games they've played there. ${v.mgmt?`Team lineups still save in the <a href="${cfg.editors.lineups}">Lineup Room editor</a> (management).`:''}</p>`;
  const $=s=>host.querySelector(s);
  const assign=(slot,id)=>{const from=POS.find(p=>st.slots[p]===id);const prev=st.slots[slot];st.slots[slot]=id;if(from&&from!==slot)st.slots[from]=prev||null;st.selP=st.selS=null;commit()};
  const swap=(a,b)=>{const t=st.slots[a];st.slots[a]=st.slots[b];st.slots[b]=t;st.selP=st.selS=null;commit()};
  function commit(){store.draft=Object.assign({},st.slots);writeStore(cfg,v,store);lineup.setSandbox(st.slots);draw()}
  function draw(){
    tonight=lineup.get().tonight;
    const tb=$('[data-act="tonight"]');tb.disabled=!tonight.six;tb.textContent=tonight.six?`Start from tonight's six · GM ${tonight.gm}`:"Tonight's six isn't posted yet";
    // rink: neutral ice from WRRink, our own slot buttons on top (same coordinates)
    const rk=$('#labSbRink'),sc=3.85,kit=tonight.kit||'home';
    WRRink.render(rk,{scale:sc,jersey:72,small:true,players:[],labels:false,kit});
    rk.querySelector('.wr-sr')?.remove();
    rk.insertAdjacentHTML('beforeend',POS.map(p=>{const id=st.slots[p],[x,y]=WRRink.XY[p],l=id?H.byId.get(id):null,f=id?H.fit(id,p):null;
      return `<button type="button" class="lab-slot${id?' on':''}${st.selS===p?' sel':''}${f&&f.k==='off'?' off':''}" data-slot="${p}" ${id?'draggable="true"':''} style="left:${(x+3)*sc}px;top:${(y+3)*sc}px"
        aria-label="${POS_LONG[p]} slot: ${id?esc(l.gamertag)+', '+esc(f.t):'empty'}">
        ${id?WRRink.jersey({name:l.jersey_name||l.gamertag,no:l.jersey_number},72,kit):'<span class="lab-slot-x"></span>'}
        <span class="lab-slot-tg"><b>${p}</b>${id?`<em>${esc(l.gamertag)}</em><small>${esc(f.t)}</small>`:'<em>Empty</em>'}</span></button>`}).join(''));
    // selection line
    const selName=st.selP?H.name(st.selP):'';
    $('#labSel').innerHTML=st.selP?`Pick a slot for <b>${esc(selName)}</b>. <button type="button" class="lab-x" data-act="cancel">Cancel</button>`
      :st.selS?`${st.slots[st.selS]?`<b>${st.selS}</b> · ${esc(H.name(st.slots[st.selS]))}: pick a player or another slot to swap. <button type="button" class="lab-x" data-act="empty">Remove from ${st.selS}</button>`:`Pick a player for <b>${st.selS}</b>.`} <button type="button" class="lab-x" data-act="cancel">Cancel</button>`
      :(st.msg||'Tap a player, then a slot.');
    st.msg='';
    // bench
    const grp=[['Forwards',l=>['LW','C','RW'].includes(String(l.position).toUpperCase())],['Defence',l=>['LD','RD'].includes(String(l.position).toUpperCase())],['Goalies',l=>String(l.position).toUpperCase()==='G'],['Other',l=>!POS.includes(String(l.position).toUpperCase())]];
    $('#labBench').innerHTML=grp.map(([g,f])=>{const ls=L.active.filter(f).sort((a,b)=>POS.indexOf(String(a.position).toUpperCase())-POS.indexOf(String(b.position).toUpperCase())||lc(a.gamertag).localeCompare(lc(b.gamertag)));
      if(!ls.length)return '';
      return `<div class="lab-bench-g"><span class="wr-k">${g} · ${ls.length}</span><div>${ls.map(l=>{const at=POS.find(p=>st.slots[p]===l.id);
        return `<button type="button" class="lab-chip${at?' in':''}${st.selP===l.id?' sel':''}" draggable="true" data-id="${l.id}" aria-pressed="${st.selP===l.id}">
          <b>${esc(l.gamertag)}</b><span>${esc(String(l.position||'?').toUpperCase())}${l.secondary_position&&String(l.secondary_position).toUpperCase()!==String(l.position).toUpperCase()?' · 2nd '+esc(String(l.secondary_position).toUpperCase()):''}${l.jersey_number?' · #'+esc(l.jersey_number):''}</span>${at?`<em>In six · ${at}</em>`:''}</button>`}).join('')}</div></div>`}).join('');
    // saved
    const saved=store.saved||[];
    $('#labSaved').innerHTML=saved.length?`<span class="wr-k">Saved on this device</span><ul>${saved.map((s,i)=>`<li><button type="button" class="lab-x" data-load="${i}">${esc(s.name)}</button><small>${esc(new Date(s.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</small><button type="button" class="lab-x" data-del="${i}" aria-label="Delete ${esc(s.name)}">Delete</button></li>`).join('')}</ul>`:'';
    // chemistry
    const c=H.chem(st.slots);
    $('#labChem').innerHTML=chemHTML(H,c,L,v);
    $('#labSbConf').innerHTML=c.complete?confChip(c.confidence,`${c.score} ${c.label}`):confChip('Projected','fill all six');
    wire();
  }
  function wire(){
    host.querySelectorAll('.lab-chip').forEach(b=>{
      b.onclick=()=>{const id=b.dataset.id;if(st.selS){assign(st.selS,id);return}st.selP=st.selP===id?null:id;draw()};
      b.ondragstart=e=>{e.dataTransfer.setData('text/plain','p:'+b.dataset.id);e.dataTransfer.effectAllowed='move'}});
    host.querySelectorAll('.lab-slot').forEach(b=>{const p=b.dataset.slot;
      b.onclick=()=>{if(st.selP){assign(p,st.selP);return}if(st.selS&&st.selS!==p){swap(st.selS,p);return}st.selS=st.selS===p?null:p;draw()};
      b.ondragstart=e=>{e.dataTransfer.setData('text/plain','s:'+p);e.dataTransfer.effectAllowed='move'};
      b.ondragover=e=>{e.preventDefault();b.classList.add('drop')};b.ondragleave=()=>b.classList.remove('drop');
      b.ondrop=e=>{e.preventDefault();const d=e.dataTransfer.getData('text/plain')||'';if(d.startsWith('p:'))assign(p,d.slice(2));else if(d.startsWith('s:')&&d.slice(2)!==p)swap(d.slice(2),p)}});
    host.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act;
      if(a==='tonight'){const t=lineup.get().tonight.six||{};POS.forEach(p=>st.slots[p]=t[p]&&L.active.some(l=>l.id===t[p])?t[p]:null);st.msg=`Loaded tonight's six (GM ${lineup.get().tonight.gm}).`;st.selP=st.selS=null;commit()}
      else if(a==='clear'){POS.forEach(p=>st.slots[p]=null);st.selP=st.selS=null;commit()}
      else if(a==='save'){if(!POS.some(p=>st.slots[p])){st.msg='Nothing to save yet.';draw();return}
        store.saved=(store.saved||[]).concat([{name:`Sandbox ${((store.saved||[]).length%99)+1} · ${SK.map(p=>st.slots[p]?H.name(st.slots[p]).slice(0,10):'–').slice(0,3).join('/')}`,slots:Object.assign({},st.slots),at:Date.now()}]).slice(-8);
        st.msg=writeStore(cfg,v,store)?'Saved on this device (not shared with the team).':'This browser blocked local saving.';draw()}
      else if(a==='cancel'){st.selP=st.selS=null;draw()}
      else if(a==='empty'){st.slots[st.selS]=null;st.selS=null;commit()}});
    host.querySelectorAll('[data-load]').forEach(b=>b.onclick=()=>{const s=(store.saved||[])[+b.dataset.load];if(!s)return;POS.forEach(p=>st.slots[p]=s.slots[p]&&L.active.some(l=>l.id===s.slots[p])?s.slots[p]:null);st.msg=`Loaded ${s.name}.`;commit()});
    host.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{store.saved.splice(+b.dataset.del,1);writeStore(cfg,v,store);draw()});
  }
  lineup.on(k=>{if(k==='tonight')draw()});
  lineup.setSandbox(st.slots);
  draw();
}

/* ---------- panel 3: simulate tonight + game sheet ---------- */
const LANE_NAME={fo:'Faceoffs',lwA:'Our LW attack',rwA:'Our RW attack',lwT:'Their LW threat',rwT:'Their RW threat',mid:'Middle',g:'Goalie duel',chem:'Our chemistry'};
function reason(l,S){
  const i=l.inputs,u=S.us,t=S.them,n=(side,p)=>esc(side[p]?.name||'—');
  switch(l.id){
    case 'fo':return `Faceoffs: ${n(u,'C')} ${i.our.raw!=null?pct(i.our.raw):'no FO data'}${i.our.fw!=null?` (${i.our.fw}–${i.our.fl})`:''} vs ${n(t,'C')} ${i.their.raw!=null?pct(i.their.raw):'no FO data'} → shrunk ${pct(i.our.shr)} vs ${pct(i.their.shr)} toward ${pct(i.base)}${i.our.est||i.their.est?' (draws estimated at 20/GP)':''}.`;
    case 'lwA':case 'rwA':return `Our ${l.us} ${n(u,l.us)} (${f2(i.our.attRaw)} G+½A/GP raw → ${f2(i.our.att)} shrunk, ${l.us} base ${f2(i.our.base)}) vs their ${l.them} ${n(t,l.them)} (${f2(i.their.dnRaw)} net def plays/GP → ${f2(i.their.dn)}).`;
    case 'lwT':case 'rwT':return `Their ${l.them} ${n(t,l.them)} (${f2(i.their.gRaw)} G/GP raw → ${f2(i.their.g)} shrunk at k=5, vs ${l.them} base ${f2(i.their.base)}) attacks our ${l.us} ${n(u,l.us)} (${f2(i.our.dpRaw)} def plays/GP)${l.key?' · key threat':''}.`;
    case 'mid':return `Middle: their C ${n(t,'C')} (${f2(i.their.aRaw)} A/GP, ${i.their.passRaw!=null?pct(i.their.passRaw):'–'} passing) vs our C ${n(u,'C')} (${f2(i.our.tiRaw)} TK+INT/GP).`;
    case 'g':return `Goalie duel: our ${n(u,'G')} ${sv3(i.our.raw)} → ${sv3(i.our.sv)} shrunk vs their ${n(t,'G')} ${sv3(i.their.raw)} → ${sv3(i.their.sv)}; expected goals against ${f2(i.xUs)} vs ${f2(i.xThem)}.`;
    case 'chem':return i.score==null?'Chemistry: fill the six.':`Chemistry ${i.score} ${esc(i.label)}, ${esc(i.confidence)} confidence${i.halved?' (weight halved)':''}.`;
  }
  return '';
}
function h2hRow(S,l){
  const mark=l.e>=.15?'up':l.e<=-.15?'dn':'eq';
  const side=(who,p,stat)=>`<div class="lab-h2h-s ${who}"><span>${p||''}</span><b>${esc((who==='us'?S.us:S.them)[p]?.name||(p?'—':''))}</b><small>${stat}</small></div>`;
  const i=l.inputs;let us='',th='';
  if(l.id==='fo'){us=i.our.raw!=null?`FO ${pct(i.our.raw)}`:'FO n/a';th=i.their.raw!=null?`FO ${pct(i.their.raw)}`:'FO n/a'}
  else if(l.id==='mid'){us=`${f2(i.our.tiRaw)} TK+INT/GP`;th=`${f2(i.their.aRaw)} A/GP`}
  else if(l.id==='lwA'||l.id==='rwA'){us=`${f2(i.our.attRaw)} G+½A/GP · ${S.us[l.us]?.gp||0} GP`;th=`${f2(i.their.dnRaw)} net DP/GP · ${S.them[l.them]?.gp||0} GP`}
  else if(l.id==='lwT'||l.id==='rwT'){us=`${f2(i.our.dpRaw)} DP/GP · ${S.us[l.us]?.gp||0} GP`;th=`${f2(i.their.gRaw)} G/GP · ${S.them[l.them]?.gp||0} GP${l.key?' · key threat':''}`}
  else if(l.id==='g'){us=`sv ${sv3(i.our.raw)}`;th=`sv ${sv3(i.their.raw)}`}
  const arrow=mark==='up'?'<i class="lab-ar up" aria-label="edge us">▲</i>':mark==='dn'?'<i class="lab-ar dn" aria-label="edge them">▼</i>':'<i class="lab-ar eq" aria-label="even">=</i>';
  if(l.id==='chem') return `<li class="lab-h2h-r m-${mark}"><div class="lab-h2h-s us"><span>Six</span><b>${i.score==null?'—':i.score+' '+esc(i.label)}</b><small>${esc(i.confidence||'')}</small></div><div class="lab-h2h-m">${arrow}<span>${LANE_NAME[l.id]}</span><em>${sgn(l.e)}</em></div><div class="lab-h2h-s them"><span>Six</span><b>Unknown</b><small>no opponent game logs</small></div></li>`;
  return `<li class="lab-h2h-r m-${mark}">${side('us',l.us,us)}<div class="lab-h2h-m">${arrow}<span>${LANE_NAME[l.id]}</span><em>${sgn(l.e)}</em></div>${side('them',l.them,th)}</li>`;
}
function gameSheetHTML(cfg,v,L,g){
  const head=`<div class="lab-gs-hd"><div><span class="wr-k">Game sheet · from Battle Plan · read-only</span><h4>GM ${g.gm} ${g.home?'vs':'@'} ${esc(g.short)}</h4></div></div>`;
  if(!v.mgmt) return `<section class="lab-gs" aria-label="Game sheet">${head}<div class="wr-empty-row">The game sheet is management-only for now.</div></section>`;
  const plan=L.plans.filter(p=>p.schedule_game_id===g.id).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  const date=new Date(g.at),d=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const edit=`<a href="${cfg.editors.battlePlan}?opponent=${encodeURIComponent(g.name)}&date=${encodeURIComponent(d)}">Open the Battle Plan editor →</a>`;
  const foot=`<p class="wr-note">Read from <code>hitmen_battle_plans</code>. Saving stays in the Battle Plan editor (management only, unchanged in this release). ${edit}</p>`;
  if(!plan) return `<section class="lab-gs" aria-label="Game sheet">${head}<div class="wr-empty-row">No game sheet saved for this game yet.</div>${foot}</section>`;
  const F=[['Status','status'],['Keys to win','keys_to_win'],['Matchup assignments','matchup_assignments'],['Danger players','danger_players'],['Tendencies','tendencies'],['Reminders','reminders'],['Management notes','management_notes']];
  return `<section class="lab-gs" aria-label="Game sheet">${head}<dl class="lab-gs-dl">${F.filter(([,k])=>plan[k]).map(([t,k])=>`<div><dt>${t}</dt><dd>${esc(plan[k])}</dd></div>`).join('')}</dl>${foot}</section>`;
}
function mountSim(host,cfg,v,D,L,H,lineup){
  const st={src:'sandbox',gm:null};
  const games=D?.games||[];
  host.innerHTML=panelHead(3,'Box-score simulation · '+PLACEHOLDER+' — box-score model, not film','Simulate Tonight','labSimTitle','<span id="labSimConf"></span>')+
   (games.length?`<div class="lab-sim-tools"><div class="lab-seg" role="group" aria-label="Which six"><button type="button" data-src="sandbox" class="on">Sandbox six</button><button type="button" data-src="tonight">Tonight's six</button></div><div id="labSimTabs"></div></div>
    <div id="labSimBody" aria-live="polite"></div><hr class="lab-div lab-div-sub"><div id="labSimSheet"></div>`
    :'<div class="wr-empty-row">No games on the schedule. Simulate Tonight runs on the next game day.</div>');
  if(!games.length){host.querySelector('#labSimConf')&&(host.querySelector('#labSimConf').innerHTML=confChip('Projected','no games'));return}
  const $=s=>host.querySelector(s);
  host.querySelectorAll('[data-src]').forEach(b=>b.onclick=()=>{st.src=b.dataset.src;host.querySelectorAll('[data-src]').forEach(x=>x.classList.toggle('on',x===b));draw()});
  const sixOf=g=>{if(st.src==='tonight'){const s=g.report?.six;if(!s)return null;const o={};POS.forEach(p=>{const l=s[p]?H.lockerByTag(s[p]):null;o[p]=l?l.id:null});return o}return lineup.get().sandbox};
  function draw(){
    const g=games.find(x=>x.gm===st.gm)||games[0];if(!g)return;
    $('#labSimSheet').innerHTML=gameSheetHTML(cfg,v,L,g);
    const r=g.report,six=sixOf(g),body=$('#labSimBody'),conf=$('#labSimConf');
    if(!r||!r.opp.length){conf.innerHTML=confChip('Projected','no report');
      body.innerHTML=`<div class="lab-noreport"><b>No scouting report yet</b><span>${v.mgmt?'No pregame report with a posted opponent six for this game yet.':'It posts here once management approves tonight\'s report.'}</span></div>`;return}
    if(!six||SK.concat('G').some(p=>!six[p])){const miss=POS.filter(p=>!six||!six[p]);conf.innerHTML=confChip('Projected','incomplete six');
      body.innerHTML=`<div class="lab-noreport"><b>${st.src==='tonight'?"Tonight's six isn't complete":'Fill the sandbox six'}</b><span>Missing ${miss.join(', ')}. ${st.src==='sandbox'?'Use "Start from tonight\'s six" in the sandbox, or place players by hand.':''}</span></div>`;return}
    const S=H.simulate(six,g),vd=S.vd;
    const sw=H.bestSwap(six,g,S);
    conf.innerHTML=confChip(S.conf.label,`${S.conf.why} · median ${S.conf.medianGP} GP`);
    const lanes=S.lanes;
    body.innerHTML=`<div class="lab-sim">
      <div class="lab-verdict">
        <span class="wr-k">Verdict · GM ${g.gm} ${g.home?'vs':'@'} ${esc(g.short)} · ${st.src==='tonight'?"tonight's six":'sandbox six'}</span>
        <div class="lab-vd"><b>${vd.verdict}</b><span>T = ${sgn(vd.T)}</span>${confChip(S.conf.label,S.conf.why)}</div>
        <ol class="lab-reasons">${vd.reasons.map(x=>`<li><i class="lab-ar ${x.c>0?'up':'dn'}">${x.c>0?'▲':'▼'}</i><span>${reason(x.l,S)}</span><em>${sgn(x.c)}</em></li>`).join('')||'<li><span>Every lane is close to even.</span></li>'}</ol>
        ${vd.threat.length?`<p class="lab-flag">Key-threat lane at ${vd.threat.map(l=>sgn(l.e)).join(', ')} (≤ −0.60) forces Risky.</p>`:''}
        ${vd.goalieFlag?`<p class="lab-flag">Our goalie's shrunk save % is under .760 against a top-third shot-volume team (rank ${S.shotRank}).</p>`:''}
        <p class="lab-swap">${sw?`Try <b>${esc(H.name(sw.id))}</b> at ${sw.p} for ${esc(H.name(sw.out))}: T ${sgn(S.vd.T)} → ${sgn(sw.s.vd.T)} (+${sw.d.toFixed(2)}).`:'No single swap lifts T by 0.10 or more. At this sample size, smaller differences are noise.'}</p>
      </div>
      <ol class="lab-h2h" aria-label="Head to head by position">${lanes.map(l=>h2hRow(S,l)).join('')}</ol>
    </div>
    <details class="lab-inputs"><summary>Show every input (raw, GP, shrinkage)</summary>
      <div class="lab-in-t" role="table" aria-label="Matchup inputs"><div class="lab-in-r lab-in-h" role="row"><span role="columnheader">Lane</span><span role="columnheader">Weight</span><span role="columnheader">Edge</span><span role="columnheader">Contribution</span><span role="columnheader">Inputs</span></div>
      ${lanes.map(l=>`<div class="lab-in-r" role="row"><span role="cell">${LANE_NAME[l.id]}</span><span role="cell">${l.w.toFixed(3)}</span><span role="cell">${sgn(l.e)}</span><span role="cell">${sgn(l.w*l.e)}</span><span role="cell">${reason(l,S)}</span></div>`).join('')}
      </div>
      <p class="wr-note"><b>${PLACEHOLDER} — box-score model, not film.</b> Every stat is shrunk toward the ${esc(cfg.league)} ${esc(cfg.seasonLabel)} position average: (n·x + k·base)/(n + k), k = 5 games, 60 draws, 100 shots. Strong: T ≥ +0.15 with no key-threat lane ≤ −0.60. Risky: T ≤ −0.15, a key-threat lane ≤ −0.60, or our goalie under .760 against a top-third shot team. Otherwise Even. Confidence is Low for a draft report or identity warnings, else by median GP (8+ High, 4–7 Medium). Our lines: ${esc(cfg.league)} season stats; theirs: <code>hitmen_opponent_player_stats</code>. Opponent six from the ${r.approved?'approved':'draft'} pregame report. ${POS.filter(p=>S.them[p]?.missing).length?`No stats found for: ${POS.filter(p=>S.them[p]?.missing).map(p=>esc(S.them[p].name)).join(', ')}.`:''}</p>
    </details>`;
  }
  WRRink.tabs($('#labSimTabs'),null,{games:TN().tabsGames(D),active:TN().initialGm(D),size:'sm',onChange:t=>{st.gm=t.gm;draw()}});
  lineup.on(()=>draw());
}

/* ---------- boot ---------- */
let mountedFor=null;
async function boot(){
  const host=document.getElementById('lineupLab'); if(!host||!window.WRRink||!M()||!TN()) return;
  const cfg=TEAMS[host.dataset.labTeam||'calgary']; if(!cfg) return;
  const v=viewer(cfg); if(!v.user){host.hidden=true;return}
  if(mountedFor===v.user.id) return; mountedFor=v.user.id;
  const D=await TN().data(); if(!D){mountedFor=null;return}
  let L;
  try{L=await loadLab(cfg,v,D)}catch(e){console.error('[lineup-lab]',e);mountedFor=null;return}
  if(!L.lockers.length){host.hidden=true;return}
  host.hidden=false;
  const H=makeHelpers(cfg,v,D,L), lineup=createLineup();
  window.HitmenLineupLab={lineup,cfg};
  // panel 1 (war-room-tonight.js) -> shared lineup object
  const onSix=e=>lineup.setTonight(e.detail||{});
  window.addEventListener('wr-six-change',onSix);
  if(TN().lastSix) lineup.setTonight(TN().lastSix);
  lineup.on((k,s)=>{if(k!=='tonight')return;const el=document.getElementById('labSixChem');if(!el)return;
    if(!s.tonight.six){el.innerHTML=confChip('Projected','not posted');return}
    const c=H.chem(s.tonight.six);el.innerHTML=c.complete?`<span class="lab-mini">Chemistry <b>${c.score}</b> ${esc(c.label)}</span>${confChip(c.confidence)}`:confChip('Projected','incomplete')});
  if(TN().lastSix) lineup.setTonight(TN().lastSix);
  try{mountSandbox(document.getElementById('labSandbox'),cfg,v,D,L,H,lineup)}catch(e){console.error('[lineup-lab] sandbox',e);document.getElementById('labSandbox').innerHTML='<div class="wr-empty-row">The sandbox could not load.</div>'}
  try{mountSim(document.getElementById('labSim'),cfg,v,D,L,H,lineup)}catch(e){console.error('[lineup-lab] simulate',e);document.getElementById('labSim').innerHTML='<div class="wr-empty-row">Simulate Tonight could not load.</div>'}
  if(L.errors.length) console.warn('[lineup-lab] partial data:',L.errors);
  const h=location.hash.slice(1); if(h&&(h==='lineupLab'||host.querySelector('#'+CSS.escape(h)))) requestAnimationFrame(()=>document.getElementById(h)?.scrollIntoView({block:'start'}));
}
window.addEventListener('vvhl-auth-change',()=>{const v=ST().user;if(!v){mountedFor=null;const h=document.getElementById('lineupLab');if(h)h.hidden=true}setTimeout(boot,0)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
window.LineupLab={TEAMS,boot};
})();
