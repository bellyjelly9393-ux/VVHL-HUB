(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => '$' + Number(v||0).toFixed(2) + 'M';

  const SAMPLE = [
    {id:1,tag:'KingLouieIV12',pos:'C',gp:21,g:29,a:32,pts:61,ppg:2.90,plusMinus:18,fo:56.8,shots:118,shooting:24.6,teamGF:96,teamGA:63,impact:0.74,reliability:'High',role:'Top-line play-driving C',fair:4.7,likely:6.25,walk:7.7},
    {id:2,tag:'SmokeShow91',pos:'RW',gp:19,g:25,a:20,pts:45,ppg:2.37,plusMinus:9,fo:null,shots:101,shooting:24.8,teamGF:81,teamGA:69,impact:0.55,reliability:'Medium',role:'Scoring winger',fair:3.6,likely:4.5,walk:5.4},
    {id:3,tag:'BlueLineIQ',pos:'RD',gp:22,g:7,a:31,pts:38,ppg:1.73,plusMinus:23,fo:null,shots:57,shooting:12.3,teamGF:88,teamGA:52,impact:0.81,reliability:'High',role:'Puck-moving top-pair D',fair:4.2,likely:5.1,walk:6.0},
    {id:4,tag:'NetFrontChaos',pos:'LW',gp:17,g:19,a:15,pts:34,ppg:2.00,plusMinus:2,fo:null,shots:79,shooting:24.1,teamGF:71,teamGA:70,impact:0.31,reliability:'Medium',role:'Net-front finisher',fair:2.8,likely:3.3,walk:4.0}
  ];

  const state = {player:null, compare:null};

  function searchPlayers(q){
    const s=String(q||'').trim().toLowerCase();
    return SAMPLE.filter(p=>!s||p.tag.toLowerCase().includes(s)||p.pos.toLowerCase()===s).slice(0,8);
  }

  function scorePlayer(p){
    if(!p) return 0;
    const production=Math.min(100,(p.ppg/3)*100);
    const impact=Math.min(100,Math.max(0,p.impact*100));
    const sample=Math.min(100,(p.gp/22)*100);
    return Math.round(production*.45+impact*.4+sample*.15);
  }

  function strengths(p){
    const out=[];
    if(p.ppg>=2.5) out.push('elite production rate');
    else if(p.ppg>=2) out.push('strong production');
    if(p.impact>=.7) out.push('excellent on-ice impact');
    else if(p.impact>=.5) out.push('positive play-driving impact');
    if((p.plusMinus||0)>=15) out.push('strong goal differential results');
    if((p.shooting||0)>=24) out.push('high finishing efficiency');
    if((p.fo||0)>=55) out.push('faceoff value');
    return out.length?out:['balanced profile without one dominant statistical signal'];
  }

  function risks(p){
    const out=[];
    if(p.gp<18) out.push('smaller sample size');
    if((p.shooting||0)>24) out.push('shooting rate may regress');
    if(p.impact<.4) out.push('limited underlying impact relative to raw scoring');
    if(p.likely>p.fair*1.2) out.push('market price may exceed modelled fair value');
    return out.length?out:['no major statistical red flag in the current sample'];
  }

  function evidenceHtml(p){
    if(!p) return '';
    const items=[
      ['Position',p.pos],['Games',p.gp],['Goals',p.g],['Assists',p.a],['Points',p.pts],['PPG',p.ppg.toFixed(2)],
      ['+/-',p.plusMinus],['FO%',p.fo==null?'—':p.fo.toFixed(1)],['Shots',p.shots],['Shooting%',p.shooting.toFixed(1)],
      ['Impact',p.impact.toFixed(2)],['Reliability',p.reliability],['Fair value',money(p.fair)],['Likely bid',money(p.likely)],['Walk above',money(p.walk)],['Role',p.role]
    ];
    return '<div class="gm-evidence-grid">'+items.map(([k,v])=>'<div class="gm-evidence-item"><small>'+esc(k)+'</small><b>'+esc(v)+'</b></div>').join('')+'</div><div class="gm-source-note">MVP source: sample structured data. Production version will replace this provider with verified league / EA / scouting data and will label every source.</div>';
  }

  function renderPlayer(){
    const root=$('gmPlayerCard'),p=state.player;
    if(!p){root.className='gm-player-card empty';root.innerHTML='<div><div class="eyebrow">CURRENT PLAYER</div><h2>Select a player</h2><p>Start with a player search.</p></div>';return;}
    root.className='gm-player-card';
    root.innerHTML='<div><div class="eyebrow">CURRENT PLAYER</div><h2>'+esc(p.tag)+'</h2><div class="gm-player-meta"><span class="gm-chip">'+esc(p.pos)+'</span><span class="gm-chip">'+esc(p.role)+'</span><span class="gm-chip">'+p.gp+' GP</span><span class="gm-chip">'+p.ppg.toFixed(2)+' PPG</span></div></div><div class="gm-player-score"><small>GM MODEL</small><b>'+scorePlayer(p)+'</b><span>/ 100</span></div>';
    $('gmEvidence').innerHTML=evidenceHtml(p);
    renderSuggestions();
  }

  function setPlayer(p){
    state.player=p;renderPlayer();
    addAI('<b>'+esc(p.tag)+'</b> loaded. I can scout the player, compare value, flag risk, or evaluate Calgary fit. Numbers shown in this MVP are sample data, not live league stats.');
  }

  function renderSearch(){
    const box=$('gmSearchResults');
    const rows=searchPlayers($('gmPlayerSearch').value);
    box.innerHTML=rows.map(p=>'<button class="gm-search-result" data-id="'+p.id+'"><b>'+esc(p.tag)+'</b><br><small>'+esc(p.pos)+' · '+p.ppg.toFixed(2)+' PPG · likely '+money(p.likely)+'</small></button>').join('');
    box.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>setPlayer(SAMPLE.find(p=>p.id===Number(b.dataset.id))));
  }

  function addUser(text){$('gmChat').insertAdjacentHTML('beforeend','<div class="gm-msg user">'+esc(text)+'</div>');scrollChat();}
  function addAI(html){$('gmChat').insertAdjacentHTML('beforeend','<div class="gm-msg ai">'+html+'</div>');scrollChat();}
  function scrollChat(){const c=$('gmChat');c.scrollTop=c.scrollHeight;}

  function answer(kind,custom=''){
    const p=state.player;
    if(!p){addAI('Select a player first so I have actual evidence to work from.');return;}
    const s=strengths(p),r=risks(p),score=scorePlayer(p);
    if(kind==='scout') return '<b>'+esc(p.tag)+' scouting read:</b> '+esc(p.role)+'. '+p.ppg.toFixed(2)+' PPG with an impact score of '+p.impact.toFixed(2)+'. Primary strengths: '+esc(s.join(', '))+'. Main risks: '+esc(r.join(', '))+'. Current model score: <b>'+score+'/100</b>.';
    if(kind==='strengths') return '<b>Strengths:</b> '+esc(s.join(', '))+'.<br><b>Weaknesses / risks:</b> '+esc(r.join(', '))+'.<br><b>Confidence:</b> '+esc(p.reliability)+' based on '+p.gp+' games.';
    if(kind==='value') return '<b>Value read:</b> modelled fair value '+money(p.fair)+', likely market '+money(p.likely)+', walk-away level '+money(p.walk)+'. '+(p.likely>p.fair*1.2?'The likely market is meaningfully above fair value, so roster context matters more than chasing the name.':'The likely market is reasonably close to fair value.') ;
    if(kind==='fit') return '<b>Calgary fit:</b> '+esc(p.role)+'. '+(p.impact>=.6?'The underlying impact supports using this player in an important role. ':'The role should be kept narrower until stronger impact is shown. ')+(p.pos==='C'?'Center value also adds lineup flexibility.':'Fit depends on Calgary\'s remaining positional need and cap.');
    if(kind==='compare'){
      const q=String($('gmCompareSearch').value||'').trim().toLowerCase();
      const b=SAMPLE.find(x=>x.tag.toLowerCase().includes(q));
      if(!b) return 'I could not find that comparison player in the MVP sample set.';
      state.compare=b;
      const aScore=scorePlayer(p),bScore=scorePlayer(b);
      return '<b>'+esc(p.tag)+' vs '+esc(b.tag)+':</b><br>'+esc(p.tag)+': '+aScore+'/100 · '+p.ppg.toFixed(2)+' PPG · likely '+money(p.likely)+'.<br>'+esc(b.tag)+': '+bScore+'/100 · '+b.ppg.toFixed(2)+' PPG · likely '+money(b.likely)+'.<br><b>Decision lens:</b> compare role need and cost efficiency, not just raw points.';
    }
    const text=custom.toLowerCase();
    if(/4\.5|price|bid|worth|cost|salary/.test(text)) return answer('value');
    if(/weak|risk|strength/.test(text)) return answer('strengths');
    if(/fit|line|chem|calgary/.test(text)) return answer('fit');
    return answer('scout')+'<br><br><small>MVP note: free-form questions currently route into deterministic hockey rules. A model provider such as Gemini Flash will be plugged in after the verified data layer is connected.</small>';
  }

  function ask(kind,custom=''){
    const label=custom || ({scout:'Scout this player',strengths:'Strengths, weaknesses & risks',value:'What is fair bidding value?',fit:'How does this player fit Calgary?',compare:'Compare players'}[kind]||kind);
    addUser(label);
    addAI(answer(kind,custom));
  }

  function renderSuggestions(){
    const p=state.player,box=$('gmSuggestions');
    if(!p){box.innerHTML='';return;}
    const qs=[
      'Is '+p.tag+' worth '+money(p.likely)+'?',
      'What could make '+p.tag+' a bad buy?',
      'What role should Calgary use '+p.tag+' in?',
      'How confident are we in this sample?'
    ];
    box.innerHTML=qs.map(q=>'<button class="gm-suggestion">'+esc(q)+'</button>').join('');
    box.querySelectorAll('button').forEach(b=>b.onclick=()=>{ $('gmQuestion').value=b.textContent; $('gmAskForm').requestSubmit(); });
  }

  $('gmSearchBtn')?.addEventListener('click',renderSearch);
  $('gmPlayerSearch')?.addEventListener('input',renderSearch);
  document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.question)));
  $('gmCompareBtn')?.addEventListener('click',()=>ask('compare'));
  $('gmAskForm')?.addEventListener('submit',e=>{e.preventDefault();const q=$('gmQuestion').value.trim();if(!q)return;ask('custom',q);$('gmQuestion').value='';});
  $('gmEvidenceToggle')?.addEventListener('click',()=>{$('gmEvidence').hidden=!$('gmEvidence').hidden;});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(()=>{renderSearch();},0));
  renderSearch();
})();