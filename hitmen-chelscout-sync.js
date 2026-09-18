(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const PREFIX='WILDMAN_CHELSCOUT:';
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const slug=v=>norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'unknown';
  const show=(text,badge)=>{
    if($('hsChelSyncMsg'))$('hsChelSyncMsg').textContent=text;
    if($('hsChelSyncBadge')&&badge)$('hsChelSyncBadge').textContent=badge;
  };

  function bookmarklet(){
    async function collector(){
      try{
        if(location.hostname!=='chelscout.net'&&location.hostname!=='www.chelscout.net'){
          alert('Open a ChelScout player report first.');return;
        }
        if(!/^\/scout\/player(?:\/\d+)?\/?$/.test(location.pathname)){
          alert('Open a ChelScout player scout report first.');return;
        }

        var clean=function(t){return String(t||'').replace(/\s+/g,' ').trim();};
        var normText=function(t){return clean(t).toLowerCase();};
        var one=function(s){var n=document.querySelector(s);return clean(n?n.innerText:'');};
        var all=function(s){return Array.from(document.querySelectorAll(s)).map(function(x){return clean(x.innerText);}).filter(Boolean);};
        var hero=document.querySelector('.hero-name');
        if(!hero){
          alert('This page does not contain a completed ChelScout player report yet. Run a normal scout first, then use Send to Wildman.');
          return;
        }

        var pos=one('.pos-badge');
        var player=Array.from(hero.childNodes)
          .filter(function(n){return n.nodeType===3;})
          .map(function(n){return clean(n.textContent);})
          .filter(Boolean).join(' ');
        if(!player){
          player=clean(hero.innerText);
          if(pos&&player.toLowerCase().endsWith(pos.toLowerCase()))player=player.slice(0,-pos.length).trim();
        }
        if(!player){
          alert('ChelScout report loaded, but the player name could not be read.');
          return;
        }

        var leagueEl=document.querySelector('input[name="league"],select[name="league"]');
        var league=clean(leagueEl&&leagueEl.value)||clean(localStorage.getItem('cs_preferred_league'))||'lgechl';
        league=league.toLowerCase();

        var pathUid=(location.pathname.match(/^\/scout\/player\/(\d+)\/?$/)||[])[1]||null;
        var match=null;
        if(!pathUid){
          try{
            var suggestUrl='/api/suggest?q='+encodeURIComponent(player)+'&league='+encodeURIComponent(league);
            var suggestRes=await fetch(suggestUrl,{credentials:'same-origin',headers:{accept:'application/json'}});
            if(suggestRes.ok){
              var suggestBody=await suggestRes.json();
              var results=Array.isArray(suggestBody)?suggestBody:(Array.isArray(suggestBody&&suggestBody.results)?suggestBody.results:[]);
              match=results.find(function(x){return normText(x&&x.username)===normText(player);})||results[0]||null;
            }
          }catch(e){}
        }

        var uid=Number(pathUid||(match&&match.user_id))||null;
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
            value:clean((x.querySelector('.rank-bar-val')||{}).innerText),
            rank:clean((x.querySelector('.rb-rank')||{}).innerText)
          };
        }).filter(function(x){return x.label||x.value||x.rank;});

        var callouts=Array.from(document.querySelectorAll('.callout')).map(function(x){
          var kind=x.classList.contains('callout-summary')?'summary':x.classList.contains('callout-read')?'read':x.classList.contains('callout-bottom')?'bottom_line':'callout';
          return {kind:kind,heading:clean((x.querySelector('.callout-head')||{}).innerText),text:clean(x.innerText)};
        }).filter(function(x){return x.text;});

        var tables=Array.from(document.querySelectorAll('.result table,.rank-bars-wrap table,.meta-box table')).slice(0,10).map(function(table){
          return {
            headers:Array.from(table.querySelectorAll('thead th')).map(function(th){return clean(th.innerText);}),
            rows:Array.from(table.querySelectorAll('tbody tr')).slice(0,100).map(function(tr){
              return Array.from(tr.children).map(function(td){return clean(td.innerText);});
            })
          };
        }).filter(function(t){return t.headers.length||t.rows.length;});

        var narratives=all('.result');
        var summary=one('.callout-summary')||null;
        var read=one('.callout-read')||null;
        var bottom=one('.callout-bottom')||null;
        var reportText=[summary,read].concat(narratives).concat([bottom]).filter(Boolean).join('\n\n');

        var payload={
          source:'chelscout',
          uid:uid,
          league:league,
          league_id:Number((match&&match.league_id)||new URLSearchParams(location.search).get('league_id'))||null,
          league_short:clean(match&&match.league_short)||null,
          player:player,
          position:pos||clean(match&&match.position)||null,
          team:clean(match&&match.team)||null,
          player_type:clean(match&&match.player_type)||null,
          meta:one('.hero-meta')||null,
          confidence:one('.hero-conf')||null,
          summary:summary,
          bottom_line:bottom,
          read:read,
          narrative:narratives.join('\n\n')||null,
          report_text:reportText||null,
          callouts:callouts,
          kpis:kpis,
          ranks:ranks,
          tables:tables,
          group_context:one('.group-bar')||null,
          freshness:one('.data-freshness')||null,
          source_url:location.href,
          source_path:location.pathname,
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
      show('Copied. Save it as a browser bookmark named “Send to Wildman”. Use it after a normal ChelScout player report finishes loading. The current report will be copied into that player’s Calgary dossier.','COPIED');
    }catch(e){
      show('Clipboard access was blocked. Use a browser that allows copying bookmark URLs, then try again.','COPY BLOCKED');
    }
  }

  function externalReport(raw){
    const reportKey=raw.uid
      ? 'player-'+raw.uid+'-league-'+(raw.league_id||raw.league||0)
      : 'player-name-'+slug(raw.player)+'-league-'+(raw.league_id||raw.league||0);
    return {
      source:'chelscout',
      source_report_id:reportKey,
      report_type:'player_scout',
      author_label:'ChelScout',
      report_title:'ChelScout Player Scout · '+(raw.player||(raw.uid?('UID '+raw.uid):'Player')),
      summary:raw.summary||raw.read||raw.narrative||raw.report_text||null,
      strengths:null,
      concerns:null,
      recommendation:raw.bottom_line||null,
      grades:{kpis:raw.kpis||[],ranks:raw.ranks||[]},
      tags:['chelscout','player_scout',raw.league||null].filter(Boolean),
      raw_payload:raw
    };
  }

  function validChelScoutSource(raw){
    if(raw?.source!=='chelscout')return false;
    if(!raw.player&&!Number(raw.uid))return false;
    try{
      const u=new URL(String(raw.source_url||''));
      if(u.protocol!=='https:'||!['chelscout.net','www.chelscout.net'].includes(u.hostname))return false;
      return /^\/scout\/player(?:\/\d+)?\/?$/.test(u.pathname);
    }catch(e){return false;}
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
    if(!validChelScoutSource(raw)){
      show('The transferred report did not pass source validation.','ERROR');
      return;
    }

    try{
      const uid=Number(raw.uid)||null;
      show(uid?'Matching ChelScout UID '+uid+' to Calgary…':'Matching '+raw.player+' to Calgary…','IMPORTING');

      let playerId=null;
      if(uid){
        const intel=await db().from('team_chelscout_intel').select('scouting_player_id').eq('team_id',TEAM_ID).eq('chelscout_uid',uid).limit(1);
        if(intel.error)throw intel.error;
        playerId=intel.data?.[0]?.scouting_player_id||null;
      }

      if(!playerId&&raw.player){
        const pool=await db().from('team_scouting_pool').select('id,scouting_player_id,scouting_players(gamertag)').eq('team_id',TEAM_ID);
        if(pool.error)throw pool.error;
        const row=(pool.data||[]).find(x=>norm(x.scouting_players?.gamertag)===norm(raw.player));
        playerId=row?.scouting_player_id||null;
      }

      if(!playerId){
        throw new Error((raw.player||('ChelScout UID '+uid))+' is not matched to a player in Calgary’s scouting pool yet.');
      }

      const now=new Date().toISOString();
      if(uid){
        const intelPayload={
          team_id:TEAM_ID,
          scouting_player_id:playerId,
          chelscout_uid:uid,
          league_id:raw.league_id||39,
          season:55,
          player_name:raw.player||null,
          signed_position:raw.position||null,
          notes:[raw.summary,raw.read,raw.bottom_line].filter(Boolean),
          raw_payload:raw,
          imported_by:state().user.id,
          imported_at:now,
          updated_at:now
        };
        const saveIntel=await db().from('team_chelscout_intel').upsert(intelPayload,{onConflict:'team_id,chelscout_uid,season'});
        if(saveIntel.error)throw saveIntel.error;
      }

      const rep=Object.assign(externalReport(raw),{
        team_id:TEAM_ID,
        scouting_player_id:playerId,
        imported_by:state().user.id,
        imported_at:now,
        updated_at:now
      });
      const saveReport=await db().from('team_external_scouting_reports').upsert(rep,{onConflict:'team_id,source,source_report_id'});
      if(saveReport.error)throw saveReport.error;

      window.name='';
      history.replaceState(null,'',location.pathname+location.search+'#hitmen-scouting');
      show('Imported the full ChelScout read for '+(raw.player||(uid?('UID '+uid):'player'))+' ✓ Open that player in the Scouting Pool to read it.','SYNCED');
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