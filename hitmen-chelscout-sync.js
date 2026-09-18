(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const PREFIX='WILDMAN_CHELSCOUT:';
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const show=(text,badge)=>{
    if($('hsChelSyncMsg'))$('hsChelSyncMsg').textContent=text;
    if($('hsChelSyncBadge')&&badge)$('hsChelSyncBadge').textContent=badge;
  };

  function bookmarklet(){
    function collector(){
      try{
        if(location.hostname!=='chelscout.net'&&location.hostname!=='www.chelscout.net'){
          alert('Open a ChelScout player report first.');return;
        }
        var path=location.pathname.match(/^\/scout\/player\/(\d+)\/?$/);
        if(!path){alert('Open the exact ChelScout player report first, not the search page.');return;}
        var clean=function(t){return String(t||'').replace(/\s+/g,' ').trim();};
        var one=function(s){var n=document.querySelector(s);return clean(n?n.innerText:'');};
        var all=function(s){return Array.from(document.querySelectorAll(s)).map(function(x){return clean(x.innerText);}).filter(Boolean);};
        var hero=document.querySelector('.hero-name');
        var pos=one('.pos-badge');
        var player='';
        if(hero){
          player=Array.from(hero.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return clean(n.textContent);}).filter(Boolean).join(' ');
          if(!player){
            player=clean(hero.innerText);
            if(pos&&player.toLowerCase().endsWith(pos.toLowerCase()))player=player.slice(0,-pos.length).trim();
          }
        }
        var kpis=Array.from(document.querySelectorAll('.kpi-tile')).map(function(x){
          return {
            label:clean((x.querySelector('.kpi-lbl')||{}).innerText),
            value:clean((x.querySelector('.kpi-val')||{}).innerText),
            rank:clean((x.querySelector('.kpi-rank')||{}).innerText)
          };
        }).filter(function(x){return x.label||x.value;});
        var ranks=Array.from(document.querySelectorAll('.rank-bar-row')).map(function(x){
          return {
            label:clean((x.querySelector('.rank-bar-label')||{}).innerText),
            value:clean((x.querySelector('.rank-bar-val')||{}).innerText)
          };
        }).filter(function(x){return x.label||x.value;});
        var payload={
          source:'chelscout',
          uid:Number(path[1]),
          league_id:Number(new URLSearchParams(location.search).get('league_id'))||null,
          player:player,
          position:pos||null,
          meta:one('.hero-meta')||null,
          confidence:one('.hero-conf')||null,
          summary:one('.callout-summary')||null,
          bottom_line:one('.callout-bottom')||null,
          read:one('.callout-read')||null,
          narrative:all('.result').join('\n\n')||null,
          kpis:kpis,
          ranks:ranks,
          freshness:one('.data-freshness')||null,
          source_url:location.href,
          captured_at:new Date().toISOString()
        };
        var w=window.open('about:blank','_blank');
        if(!w){alert('Allow popups once, then tap Send to Wildman again.');return;}
        w.name='WILDMAN_CHELSCOUT:'+JSON.stringify(payload);
        w.location='https://wildmanhockey-esportshub.vercel.app/hitmen-workspace.html#chelscout-sync';
      }catch(e){
        alert('ChelScout sync could not read this report.');
      }
    }
    return 'javascript:('+collector.toString()+')();';
  }

  async function copyBookmark(){
    try{
      await navigator.clipboard.writeText(bookmarklet());
      show('Copied. Create or edit a browser bookmark named “Send to Wildman” and paste this as its URL. Then use that bookmark on any exact ChelScout player report.','COPIED');
    }catch(e){
      show('Clipboard access was blocked. Use a browser that allows copying bookmark URLs, then try again.','COPY BLOCKED');
    }
  }

  function externalReport(raw){
    return {
      source:'chelscout',
      source_report_id:'player-'+raw.uid+'-league-'+(raw.league_id||0),
      report_type:'player_scout',
      author_label:'ChelScout',
      report_title:'ChelScout Player Scout · '+(raw.player||('UID '+raw.uid)),
      summary:raw.summary||raw.read||raw.narrative||null,
      strengths:null,
      concerns:null,
      recommendation:raw.bottom_line||null,
      grades:{kpis:raw.kpis||[],ranks:raw.ranks||[]},
      tags:['chelscout','player_scout'],
      raw_payload:raw
    };
  }

  async function consume(){
    if(location.hash!=='#chelscout-sync'||!String(window.name||'').startsWith(PREFIX))return;
    if(!db()||!state().user){
      show('ChelScout report received. Sign into Wildman management and this tab will finish the import.','WAITING');
      return;
    }
    let raw;
    try{raw=JSON.parse(String(window.name).slice(PREFIX.length));}
    catch(e){show('The ChelScout transfer payload was unreadable.','ERROR');return;}
    if(raw?.source!=='chelscout'||!Number.isInteger(Number(raw.uid))||!/https:\/\/(?:www\.)?chelscout\.net\/scout\/player\/\d+/.test(String(raw.source_url||''))){
      show('The transferred report did not pass source validation.','ERROR');
      return;
    }
    try{
      show('Matching ChelScout UID '+raw.uid+' to Calgary…','IMPORTING');
      const intel=await db().from('team_chelscout_intel').select('scouting_player_id').eq('team_id',TEAM_ID).eq('chelscout_uid',Number(raw.uid)).limit(1);
      if(intel.error)throw intel.error;
      let playerId=intel.data?.[0]?.scouting_player_id||null;
      if(!playerId&&raw.player){
        const pool=await db().from('team_scouting_pool').select('id,scouting_player_id,scouting_players(gamertag)').eq('team_id',TEAM_ID);
        if(pool.error)throw pool.error;
        const row=(pool.data||[]).find(x=>norm(x.scouting_players?.gamertag)===norm(raw.player));
        playerId=row?.scouting_player_id||null;
      }
      if(!playerId)throw new Error('ChelScout UID '+raw.uid+' ('+(raw.player||'unknown player')+') is not matched to a player in Calgary’s scouting pool yet.');

      const now=new Date().toISOString();
      const intelPayload={
        team_id:TEAM_ID,scouting_player_id:playerId,chelscout_uid:Number(raw.uid),
        league_id:raw.league_id||39,season:55,player_name:raw.player||null,
        signed_position:raw.position||null,notes:[raw.summary,raw.bottom_line].filter(Boolean),
        raw_payload:raw,imported_by:state().user.id,imported_at:now,updated_at:now
      };
      const saveIntel=await db().from('team_chelscout_intel').upsert(intelPayload,{onConflict:'team_id,chelscout_uid,season'});
      if(saveIntel.error)throw saveIntel.error;

      const rep=Object.assign(externalReport(raw),{
        team_id:TEAM_ID,scouting_player_id:playerId,imported_by:state().user.id,
        imported_at:now,updated_at:now
      });
      const saveReport=await db().from('team_external_scouting_reports').upsert(rep,{onConflict:'team_id,source,source_report_id'});
      if(saveReport.error)throw saveReport.error;

      window.name='';
      history.replaceState(null,'',location.pathname+location.search+'#hitmen-scouting');
      show('Imported ChelScout report for '+(raw.player||('UID '+raw.uid))+' ✓ Open that player in the Scouting Pool to read it.','SYNCED');
      setTimeout(()=>window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:state()})),120);
    }catch(e){
      show(e.message||'ChelScout report import failed.','ERROR');
    }
  }

  function bind(){
    const button=$('hsCopyChelSync');
    if(button&&!button.dataset.bound){
      button.dataset.bound='1';
      button.addEventListener('click',copyBookmark);
    }
    consume();
  }

  const obs=new MutationObserver(bind);
  window.addEventListener('vvhl-auth-change',()=>setTimeout(consume,80));
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{bind();obs.observe(document.body,{subtree:true,childList:true});});
  }else{
    bind();
    obs.observe(document.body,{subtree:true,childList:true});
  }
})();