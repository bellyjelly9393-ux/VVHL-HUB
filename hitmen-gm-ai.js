(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => v==null ? '—' : '$' + Number(v||0).toFixed(2) + 'M';
  const num = v => Number(v)||0;

  const SAMPLE = [
    {id:'sample-1',tag:'KingLouieIV12',pos:'C',gp:21,g:29,a:32,pts:61,ppg:2.90,plusMinus:18,fo:56.8,shots:118,shooting:24.6,passes:0,passAttempts:0,passPct:null,giveaways:0,takeaways:0,interceptions:0,blocks:0,hits:0,impact:0.74,reliability:'High',role:'Top-line play-driving C',fair:4.7,likely:6.25,walk:7.7,source:'sample'},
    {id:'sample-2',tag:'SmokeShow91',pos:'RW',gp:19,g:25,a:20,pts:45,ppg:2.37,plusMinus:9,fo:null,shots:101,shooting:24.8,passes:0,passAttempts:0,passPct:null,giveaways:0,takeaways:0,interceptions:0,blocks:0,hits:0,impact:0.55,reliability:'Medium',role:'Scoring winger',fair:3.6,likely:4.5,walk:5.4,source:'sample'},
    {id:'sample-3',tag:'BlueLineIQ',pos:'RD',gp:22,g:7,a:31,pts:38,ppg:1.73,plusMinus:23,fo:null,shots:57,shooting:12.3,passes:0,passAttempts:0,passPct:null,giveaways:0,takeaways:0,interceptions:0,blocks:0,hits:0,impact:0.81,reliability:'High',role:'Puck-moving top-pair D',fair:4.2,likely:5.1,walk:6.0,source:'sample'},
    {id:'sample-4',tag:'NetFrontChaos',pos:'LW',gp:17,g:19,a:15,pts:34,ppg:2.00,plusMinus:2,fo:null,shots:79,shooting:24.1,passes:0,passAttempts:0,passPct:null,giveaways:0,takeaways:0,interceptions:0,blocks:0,hits:0,impact:0.31,reliability:'Medium',role:'Net-front finisher',fair:2.8,likely:3.3,walk:4.0,source:'sample'}
  ];

  const state = {player:null, compare:null, players:[...SAMPLE], source:'sample'};

  function normalizePos(row){
    if(row.position==='goalie') return 'G';
    if(row.position==='center') return 'C';
    if(row.position==='leftWing') return 'LW';
    if(row.position==='rightWing') return 'RW';
    if(row.position==='defenseMen') return String(row.posSorted)==='1' ? 'LD' : String(row.posSorted)==='2' ? 'RD' : 'D';
    return row.position || '—';
  }

  function roleFor(p){
    if(p.pos==='G') return 'Goalie';
    if(p.pos==='C' && (p.fo||0)>=55) return 'Two-way / faceoff center';
    if(['LD','RD','D'].includes(p.pos)){
      if((p.blocks/p.gp)>=2) return 'Shot-blocking defenseman';
      if((p.a/p.gp)>=1) return 'Puck-moving defenseman';
      return 'Two-way defenseman';
    }
    if((p.g/p.gp)>=1) return 'Goal-scoring winger';
    if((p.a/p.gp)>=1) return 'Playmaking winger';
    return 'Forward';
  }

  function parseChelStats(payload){
    const games=Array.isArray(payload?.games)?payload.games:[];
    if(!games.length) throw new Error('No games array found in this response.');
    const map=new Map();

    for(const game of games){
      const seen=new Set();
      const clubs=game.clubs||{};
      const playersByClub=game.players||{};
      for(const [clubId,players] of Object.entries(playersByClub)){
        for(const [playerId,row] of Object.entries(players||{})){
          if(!row?.playername) continue;
          const toi=num(row.toiseconds);
          if(toi<=0) continue; // filter zero-TOI ghosts / aborted records
          const key=String(playerId);
          if(seen.has(key)) continue;
          seen.add(key);

          if(!map.has(key)) map.set(key,{
            id:key,tag:row.playername,pos:normalizePos(row),gp:0,wins:0,g:0,a:0,plusMinus:0,shots:0,shotAttempts:0,
            passes:0,passAttempts:0,giveaways:0,takeaways:0,interceptions:0,blocks:0,hits:0,penaltiesDrawn:0,pim:0,
            possession:0,fow:0,fol:0,goalieShots:0,goalieSaves:0,goalieGA:0,breakawayShots:0,breakawaySaves:0,
            source:'chelstats'
          });
          const p=map.get(key);
          p.tag=row.playername;
          p.pos=normalizePos(row);
          p.gp++;
          p.g+=num(row.skgoals); p.a+=num(row.skassists); p.plusMinus+=num(row.skplusmin);
          p.shots+=num(row.skshots); p.shotAttempts+=num(row.skshotattempts);
          p.passes+=num(row.skpasses); p.passAttempts+=num(row.skpassattempts);
          p.giveaways+=num(row.skgiveaways); p.takeaways+=num(row.sktakeaways);
          p.interceptions+=num(row.skinterceptions); p.blocks+=num(row.skbs); p.hits+=num(row.skhits);
          p.penaltiesDrawn+=num(row.skpenaltiesdrawn); p.pim+=num(row.skpim); p.possession+=num(row.skpossession);
          p.fow+=num(row.skfow); p.fol+=num(row.skfol);
          p.goalieShots+=num(row.glshots); p.goalieSaves+=num(row.glsaves); p.goalieGA+=num(row.glga);
          p.breakawayShots+=num(row.glbrkshots); p.breakawaySaves+=num(row.glbrksaves);

          const club=clubs[clubId];
          if(club && num(club.goals)>num(club.goalsAgainst)) p.wins++;
        }
      }
    }

    return [...map.values()].map(p=>{
      p.pts=p.g+p.a;
      p.ppg=p.gp?p.pts/p.gp:0;
      p.shooting=p.shots?p.g/p.shots*100:0;
      p.passPct=p.passAttempts?p.passes/p.passAttempts*100:null;
      p.fo=(p.fow+p.fol)?p.fow/(p.fow+p.fol)*100:null;
      p.winPct=p.gp?p.wins/p.gp*100:0;
      p.savePct=p.goalieShots?p.goalieSaves/p.goalieShots*100:null;
      p.breakawaySavePct=p.breakawayShots?p.breakawaySaves/p.breakawayShots*100:null;
      p.reliability=p.gp>=15?'High':p.gp>=8?'Medium':'Low';
      p.role=roleFor(p);
      p.impact=null; p.fair=null; p.likely=null; p.walk=null;
      return p;
    }).sort((a,b)=>b.gp-a.gp || b.ppg-a.ppg);
  }

  function searchPlayers(q){
    const s=String(q||'').trim().toLowerCase();
    return state.players.filter(p=>!s||p.tag.toLowerCase().includes(s)||String(p.pos).toLowerCase()===s).slice(0,12);
  }

  function scorePlayer(p){
    if(!p) return null;
    if(p.source==='chelstats') return null;
    const production=Math.min(100,(p.ppg/3)*100);
    const impact=Math.min(100,Math.max(0,(p.impact||0)*100));
    const sample=Math.min(100,(p.gp/22)*100);
    return Math.round(production*.45+impact*.4+sample*.15);
  }

  function strengths(p){
    const out=[];
    if(p.pos==='G'){
      if((p.savePct||0)>=85) out.push('strong save percentage in this sample');
      if((p.breakawaySavePct||0)>=60 && p.breakawayShots>=3) out.push('positive breakaway results');
      return out.length?out:['goalie sample needs more volume before a strong read'];
    }
    if(p.ppg>=2.5) out.push('elite production rate');
    else if(p.ppg>=2) out.push('strong production');
    else if(p.ppg>=1.5) out.push('useful scoring contribution');
    if((p.passPct||0)>=80 && p.passAttempts>=20) out.push('efficient passing');
    if((p.fo||0)>=55) out.push('faceoff value');
    if(p.gp && p.takeaways/p.gp>=3) out.push('strong takeaway activity');
    if(p.gp && p.blocks/p.gp>=2) out.push('shot-blocking activity');
    if(p.gp && p.giveaways/p.gp<=4) out.push('controlled puck-management results');
    return out.length?out:['balanced statistical profile without one dominant signal'];
  }

  function risks(p){
    const out=[];
    if(p.gp<8) out.push('very small sample size');
    else if(p.gp<15) out.push('moderate sample size');
    if(p.source==='chelstats' && p.shots>=5 && p.shooting>35) out.push('finishing rate is extremely high and may not hold');
    if(p.source==='chelstats' && p.gp && p.giveaways/p.gp>=8) out.push('high giveaway rate');
    if(p.source==='sample' && p.likely>p.fair*1.2) out.push('market price may exceed modelled fair value');
    return out.length?out:['no major red flag from the currently loaded box-score sample'];
  }

  function evidenceHtml(p){
    if(!p) return '';
    const items=[
      ['Source',p.source==='chelstats'?'ChelStats game records':'MVP sample'],['Position',p.pos],['Games',p.gp],['Record',p.source==='chelstats'?p.wins+'-'+(p.gp-p.wins):'—'],
      ['Goals',p.g],['Assists',p.a],['Points',p.pts],['PPG',p.ppg.toFixed(2)],['+/-',p.plusMinus],
      ['Shots',p.shots],['Shooting%',p.shooting.toFixed(1)],['Pass%',p.passPct==null?'—':p.passPct.toFixed(1)],
      ['Giveaways',p.giveaways],['Takeaways',p.takeaways],['Interceptions',p.interceptions],['Blocks',p.blocks],
      ['Hits',p.hits],['FO%',p.fo==null?'—':p.fo.toFixed(1)],['Win%',p.winPct==null?'—':p.winPct.toFixed(1)],
      ['SV%',p.savePct==null?'—':p.savePct.toFixed(1)],['Breakaway SV%',p.breakawaySavePct==null?'—':p.breakawaySavePct.toFixed(1)],
      ['Fair value',money(p.fair)],['Likely bid',money(p.likely)],['Walk above',money(p.walk)],['Role',p.role]
    ];
    const note=p.source==='chelstats'
      ? 'Source: imported ChelStats game payload. Totals and percentages are recomputed from individual player game rows. Zero-TOI records are excluded, and the payload\'s summed aggregate percentage fields are intentionally ignored.'
      : 'MVP source: sample structured data.';
    return '<div class="gm-evidence-grid">'+items.map(([k,v])=>'<div class="gm-evidence-item"><small>'+esc(k)+'</small><b>'+esc(v)+'</b></div>').join('')+'</div><div class="gm-source-note">'+esc(note)+'</div>';
  }

  function renderPlayer(){
    const root=$('gmPlayerCard'),p=state.player;
    if(!p){root.className='gm-player-card empty';root.innerHTML='<div><div class="eyebrow">CURRENT PLAYER</div><h2>Select a player</h2><p>Search the imported ChelStats set or the fallback sample set.</p></div>';return;}
    const score=scorePlayer(p);
    root.className='gm-player-card';
    root.innerHTML='<div><div class="eyebrow">CURRENT PLAYER</div><h2>'+esc(p.tag)+'</h2><div class="gm-player-meta"><span class="gm-chip">'+esc(p.pos)+'</span><span class="gm-chip">'+esc(p.role)+'</span><span class="gm-chip">'+p.gp+' GP</span><span class="gm-chip">'+p.ppg.toFixed(2)+' PPG</span></div></div><div class="gm-player-score"><small>'+(score==null?'VERIFIED DATA':'GM MODEL')+'</small><b>'+(score==null?'✓':score)+'</b><span>'+(score==null?' imported':'/ 100')+'</span></div>';
    $('gmEvidence').innerHTML=evidenceHtml(p);
    renderSuggestions();
  }

  function setPlayer(p){
    state.player=p;renderPlayer();
    addAI('<b>'+esc(p.tag)+'</b> loaded from '+(p.source==='chelstats'?'imported ChelStats game data':'the MVP sample set')+'.');
  }

  function renderSearch(){
    const box=$('gmSearchResults');
    const rows=searchPlayers($('gmPlayerSearch').value);
    box.innerHTML=rows.map(p=>'<button class="gm-search-result" data-id="'+esc(p.id)+'"><b>'+esc(p.tag)+'</b><br><small>'+esc(p.pos)+' · '+p.gp+' GP · '+p.ppg.toFixed(2)+' PPG</small></button>').join('');
    box.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>setPlayer(state.players.find(p=>String(p.id)===String(b.dataset.id))));
  }

  function addUser(text){$('gmChat').insertAdjacentHTML('beforeend','<div class="gm-msg user">'+esc(text)+'</div>');scrollChat();}
  function addAI(html){$('gmChat').insertAdjacentHTML('beforeend','<div class="gm-msg ai">'+html+'</div>');scrollChat();}
  function scrollChat(){const c=$('gmChat');c.scrollTop=c.scrollHeight;}

  function answer(kind,custom=''){
    const p=state.player;
    if(!p) return 'Select a player first so I have actual evidence to work from.';
    const s=strengths(p),r=risks(p),score=scorePlayer(p);
    if(kind==='scout'){
      const base='<b>'+esc(p.tag)+' scouting read:</b> '+esc(p.role)+'. '+p.ppg.toFixed(2)+' PPG across '+p.gp+' games. Primary strengths: '+esc(s.join(', '))+'. Main risks: '+esc(r.join(', '))+'.';
      return p.source==='chelstats'?base+' This read is box-score grounded only. VOD and league-context layers are not applied yet.':base+' Current model score: <b>'+score+'/100</b>.';
    }
    if(kind==='strengths') return '<b>Strengths:</b> '+esc(s.join(', '))+'.<br><b>Weaknesses / risks:</b> '+esc(r.join(', '))+'.<br><b>Confidence:</b> '+esc(p.reliability)+' based on '+p.gp+' games.';
    if(kind==='value'){
      if(p.source==='chelstats') return '<b>Bidding value model is not turned on for imported players yet.</b> We now have the real performance layer, but I am intentionally not inventing a dollar value until salary history, positional market data, cap context and comparable bids are connected.';
      return '<b>Value read:</b> modelled fair value '+money(p.fair)+', likely market '+money(p.likely)+', walk-away level '+money(p.walk)+'.';
    }
    if(kind==='fit') return '<b>Calgary fit:</b> '+esc(p.role)+'. '+(p.pos==='C'?'Center gives lineup flexibility. ':'Fit should be judged against Calgary\'s positional need and remaining cap. ')+'Current evidence: '+p.ppg.toFixed(2)+' PPG, '+(p.passPct==null?'no passing sample':p.passPct.toFixed(1)+'% passing')+', '+p.takeaways+' takeaways, '+p.giveaways+' giveaways.';
    if(kind==='compare'){
      const q=String($('gmCompareSearch').value||'').trim().toLowerCase();
      const b=state.players.find(x=>x.tag.toLowerCase().includes(q));
      if(!b) return 'I could not find that comparison player in the currently loaded data.';
      state.compare=b;
      return '<b>'+esc(p.tag)+' vs '+esc(b.tag)+':</b><br>'+esc(p.tag)+': '+p.gp+' GP · '+p.ppg.toFixed(2)+' PPG · '+p.g+' G · '+p.a+' A · '+p.giveaways+' GV · '+p.takeaways+' TK.<br>'+esc(b.tag)+': '+b.gp+' GP · '+b.ppg.toFixed(2)+' PPG · '+b.g+' G · '+b.a+' A · '+b.giveaways+' GV · '+b.takeaways+' TK.<br><b>Decision lens:</b> role, sample size and position matter more than simply sorting by points.';
    }
    const text=custom.toLowerCase();
    if(/price|bid|worth|cost|salary/.test(text)) return answer('value');
    if(/weak|risk|strength/.test(text)) return answer('strengths');
    if(/fit|line|chem|calgary/.test(text)) return answer('fit');
    return answer('scout');
  }

  function ask(kind,custom=''){
    const label=custom || ({scout:'Scout this player',strengths:'Strengths, weaknesses & risks',value:'What is fair bidding value?',fit:'How does this player fit Calgary?',compare:'Compare players'}[kind]||kind);
    addUser(label); addAI(answer(kind,custom));
  }

  function renderSuggestions(){
    const p=state.player,box=$('gmSuggestions');
    if(!p){box.innerHTML='';return;}
    const qs=['What are '+p.tag+'\'s biggest strengths?','What could make '+p.tag+' a risky target?','What role should Calgary use '+p.tag+' in?','How confident are we in this sample?'];
    box.innerHTML=qs.map(q=>'<button class="gm-suggestion">'+esc(q)+'</button>').join('');
    box.querySelectorAll('button').forEach(b=>b.onclick=()=>{$('gmQuestion').value=b.textContent;$('gmAskForm').requestSubmit();});
  }

  function importChelStats(){
    const status=$('gmImportStatus');
    try{
      const raw=$('gmChelStatsJson').value.trim();
      if(!raw) throw new Error('Paste a ChelStats JSON response first.');
      const payload=JSON.parse(raw);
      const players=parseChelStats(payload);
      if(!players.length) throw new Error('No valid player game rows were found.');
      state.players=players; state.source='chelstats'; state.player=null; state.compare=null;
      renderPlayer(); renderSearch(); $('gmChat').innerHTML=''; $('gmEvidence').innerHTML='';
      status.textContent='Imported '+players.length+' players from '+payload.games.length+' game records. Zero-TOI rows filtered.';
      status.className='gm-import-status success';
      addAI('<b>ChelStats data imported.</b> Search any player from the loaded games. All totals are recomputed from the individual game rows.');
    }catch(err){
      status.textContent=err.message||'Import failed.';
      status.className='gm-import-status error';
    }
  }

  $('gmSearchBtn')?.addEventListener('click',renderSearch);
  $('gmPlayerSearch')?.addEventListener('input',renderSearch);
  $('gmImportChelStats')?.addEventListener('click',importChelStats);
  document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.question)));
  $('gmCompareBtn')?.addEventListener('click',()=>ask('compare'));
  $('gmAskForm')?.addEventListener('submit',e=>{e.preventDefault();const q=$('gmQuestion').value.trim();if(!q)return;ask('custom',q);$('gmQuestion').value='';});
  $('gmEvidenceToggle')?.addEventListener('click',()=>{$('gmEvidence').hidden=!$('gmEvidence').hidden;});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(renderSearch,0));
  renderSearch();
})();