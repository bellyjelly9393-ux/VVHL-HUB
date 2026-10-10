/* Wildman live desk v2: manual Twitch/YouTube slots + official game feeds.
   Viewer presets live only in their browser. Source and game changes refresh without
   remounting unchanged players. No credentials or stream keys are collected. */
(() => {
  'use strict';
  const API='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const LIMIT=8, STORE='wildman.multiview.v2';
  const $=id=>document.getElementById(id);
  const db=window.supabase && window.supabase.createClient(API,KEY);
  const S={channels:new Map(),selected:[],manual:[],muted:{},focused:'',auto:true,updated:0,loading:false,request:0};
  if(!db)return;
  const text=(v)=>String(v == null ? '' : v);
  const safe=(s)=>text(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function stream(raw) {
    try {
      const u=new URL(text(raw).trim());
      if(u.protocol!=='https:')return null;
      const host=u.hostname.toLowerCase().replace(/^www\./,'');
      const path=u.pathname.split('/').filter(Boolean);
      if(host==='twitch.tv'||host==='m.twitch.tv') {
        const index=path.findIndex(p=>p==='videos'||p==='v');
        const vid=index>=0 ? path[index+1] : '';
        if(vid && /^[0-9]{5,15}$/.test(vid))return {provider:'twitch',id:'v'+vid,url:'https://www.twitch.tv/videos/'+vid};
        if(path[0] && /^[a-z0-9_]{3,25}$/i.test(path[0]))return {provider:'twitch',id:path[0].toLowerCase(),url:'https://www.twitch.tv/'+path[0].toLowerCase()};
      }
      if(host==='youtu.be'||host==='youtube.com'||host==='m.youtube.com'||host==='youtube-nocookie.com'){
        const id=host==='youtu.be'?path[0]:u.searchParams.get('v')||(['live','embed','shorts'].includes(path[0])?path[1]:'');
        if(id && /^[\w-]{11}$/.test(id))return {provider:'youtube',id,url:'https://www.youtube.com/watch?v='+id};
      }
    } catch(_){}
    return null;
  }
  function readStore() {
    try {
      const x=JSON.parse(localStorage.getItem(STORE)||'{}');
      if(Array.isArray(x.manual))S.manual=x.manual.filter(e=>e&&stream(e.url)).slice(0,30).map(e=>({key:text(e.key),title:text(e.title).slice(0,80),url:stream(e.url).url,provider:stream(e.url).provider}));
      if(Array.isArray(x.selected))S.selected=x.selected.map(text).slice(0,LIMIT);
      if(x.muted&&typeof x.muted==='object')S.muted=x.muted;
      if(x.auto===false)S.auto=false;
      if(Array.isArray(x.lastKnown))x.lastKnown.slice(0,15).forEach(e=>{
        if(e&&text(e.key).startsWith('source:')&&stream(e.url))S.channels.set(e.key,{key:e.key,title:text(e.title),url:stream(e.url).url,provider:stream(e.url).provider,meta:'Saved channel',status:'saved'});
      });
    } catch(e){console.warn('Multiview preset unavailable',e);}
  }
  function save(){
    try {
      const lastKnown=[...S.channels.values()].filter(e=>S.selected.includes(e.key)&&e.key.startsWith('source:'));
      localStorage.setItem(STORE,JSON.stringify({manual:S.manual,selected:S.selected,muted:S.muted,auto:S.auto,lastKnown}));
    } catch(_){}
    const u=new URL(location.href),ids=S.selected.filter(x=>!x.startsWith('manual:'));
    if(ids.length)u.searchParams.set('streams',ids.join(','));else u.searchParams.delete('streams');
    u.searchParams.delete('games'); history.replaceState(null,'',u);
  }
  function fromQuery(){
    const q=new URLSearchParams(location.search);
    const ids=(q.get('streams')||q.get('games')||'').split(',').filter(Boolean).slice(0,LIMIT);
    if(ids.length)S.selected=ids.map(x=>x.includes(':')?x:'game:'+x);
  }
  function all(){
    const m=S.manual.map(e=>Object.assign({meta:'My channel',status:'manual'},e));
    return [...S.channels.values(),...m].sort((a,b)=>{
      const rank=e=>e.status==='live'?0:e.status==='scheduled'?1:e.status==='manual'?2:3;
      return rank(a)-rank(b)||a.title.localeCompare(b.title);
    });
  }
  function active(key){return all().find(x=>x.key===key);}
  function statusLine(){
    const n=all().filter(x=>x.status==='live').length;
    $('multiviewStatus').textContent=S.selected.length+'/'+LIMIT+' SELECTED · '+n+' LIVE LISTED';
    const stamp=$('liveRefreshStamp');
    if(stamp&&S.updated)stamp.textContent='Updated '+new Date(S.updated).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  }
  function mountPicker(){
    const root=$('multiviewPicker');
    root.textContent='';
    const rows=all();
    if(!rows.length){root.textContent='No assigned live broadcasts. Add a Twitch or YouTube channel below.';return;}
    rows.forEach(x=>{
      const item=document.createElement('label');item.className='multi-pick';
      const input=document.createElement('input');input.type='checkbox';input.checked=S.selected.includes(x.key);
      input.addEventListener('change',()=>{
        if(input.checked && S.selected.length>=LIMIT){input.checked=false;note('Eight feeds is the maximum. Remove one first.');return;}
        if(input.checked&&!S.selected.includes(x.key))S.selected.push(x.key);
        if(!input.checked)S.selected=S.selected.filter(y=>y!==x.key);
        save(); mountPicker();renderGrid();
      });
      const copy=document.createElement('div');
      const strong=document.createElement('strong');strong.textContent=x.title;
      const info=document.createElement('small');info.textContent=x.meta+' · '+x.status.toUpperCase()+' · '+x.provider.toUpperCase();
      copy.append(strong,info);item.append(input,copy);
      if(x.key.startsWith('manual:')){
        const del=document.createElement('button');del.type='button';del.className='mv-mini';del.textContent='Delete';
        del.title='Remove saved personal channel';
        del.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();S.manual=S.manual.filter(y=>y.key!==x.key);S.selected=S.selected.filter(y=>y!==x.key);save();mountPicker();renderGrid();});
        item.append(del);
      }
      root.append(item);
    });
  }
  function note(message){const el=$('multiviewNotice');if(el)el.textContent=message;}
  function iframeSrc(row,key){
    const v=stream(row.url);if(!v)return '';
    const mute=S.muted[key]!==false;
    if(v.provider==='twitch'){
      const params=new URLSearchParams();
      if(/^v[0-9]{5,15}$/.test(v.id))params.set('video',v.id);else params.set('channel',v.id);
      params.set('parent',location.hostname);params.set('autoplay','false');params.set('muted',mute?'true':'false');
      return 'https://player.twitch.tv/?'+params.toString();
    }
    return 'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(v.id)+'?playsinline=1&autoplay=0&mute='+(mute?'1':'0')+'&enablejsapi=1';
  }
  function tileBtn(label,handler,title){
    const b=document.createElement('button');b.type='button';b.className='mv-mini';b.textContent=label;
    if(title)b.title=title;b.addEventListener('click',handler);return b;
  }
  function buildTile(key){
    const row=active(key);if(!row)return null;
    const item=document.createElement('article');item.className='multi-tile mv-tile';item.dataset.key=key;
    const heading=document.createElement('div');heading.className='multi-tile-head';
    const title=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=row.title;
    const info=document.createElement('small');info.className='mv-state';info.textContent=row.meta+' · '+row.status.toUpperCase();
    title.append(strong,info);
    const ext=document.createElement('a');ext.className='mv-mini';ext.href=row.url;ext.target='_blank';ext.rel='noopener noreferrer';ext.textContent='Open ↗';
    heading.append(title,ext);item.append(heading);
    const frame=document.createElement('div');frame.className='mv-frame';
    const embed=document.createElement('iframe');embed.title='Live feed: '+row.title;embed.src=iframeSrc(row,key);
    embed.allow='autoplay; fullscreen; encrypted-media; picture-in-picture';embed.allowFullscreen=true;
    embed.loading='eager';embed.referrerPolicy='strict-origin-when-cross-origin';
    frame.append(embed);item.append(frame);
    const controls=document.createElement('div');controls.className='mv-controls';
    controls.append(
      tileBtn('◀',()=>move(key,-1),'Move stream left'),
      tileBtn('▶',()=>move(key,1),'Move stream right'),
      tileBtn(S.muted[key]===false?'Audio on':'Muted',()=>toggleAudio(key),'Twitch audio changes restart the player; you can also use controls in each stream'),
      tileBtn('Focus',()=>focus(key),'Focus or unfocus this stream'),
      tileBtn('Reload',()=>{embed.src=iframeSrc(active(key),key);note('Reloading '+row.title);},'Restart this embed without touching the others'),
      tileBtn('Full screen',()=>{if(item.requestFullscreen)item.requestFullscreen().catch(()=>focus(key));else focus(key);},'Expand this tile'),
      tileBtn('× Remove',()=>{S.selected=S.selected.filter(x=>x!==key);if(S.focused===key)S.focused='';save();mountPicker();renderGrid();},'Remove this feed')
    );
    item.append(controls);return item;
  }
  function move(key,offset){
    const i=S.selected.indexOf(key),j=i+offset;if(j<0||j>=S.selected.length)return;
    [S.selected[i],S.selected[j]]=[S.selected[j],S.selected[i]];
    save(); renderGrid();
  }
  function toggleAudio(key){
    S.muted[key]=!(S.muted[key]!==false);
    const tile=[...$('multiviewGrid').children].find(x=>x.dataset.key===key);
    const frame=tile?.querySelector('iframe');
    if(frame)frame.src=iframeSrc(active(key),key);
    const c=tile?.querySelectorAll('.mv-controls button')[2];
    if(c)c.textContent=S.muted[key]===false?'Audio on':'Muted';
    save();note('Audio updated. The stream player may restart.');
  }
  function focus(key){
    S.focused=S.focused===key?'':key;
    renderGrid();
  }
  function renderGrid(){
    const grid=$('multiviewGrid');const keys=S.selected.filter(k=>active(k));
    const liveChildren=[...grid.querySelectorAll('.mv-tile')];
    liveChildren.forEach(x=>{if(!keys.includes(x.dataset.key))x.remove();});
    keys.forEach((key,i)=>{
      let x=[...grid.querySelectorAll('.mv-tile')].find(e=>e.dataset.key===key);
      if(!x){x=buildTile(key);if(x)grid.append(x);}
      if(x){x.style.order=String(i);x.classList.toggle('mv-focused',S.focused===key);}
    });
    grid.classList.toggle('mv-is-focused',!!S.focused);
    grid.dataset.columns=$('mvColumns')?.value||'auto';
    const empty=grid.querySelector('.mv-empty');
    if(!keys.length){if(!empty){const e=document.createElement('p');e.className='empty-state mv-empty';e.textContent='Choose live channels above or add a Twitch / YouTube feed to begin.';grid.append(e);}}
    else if(empty)empty.remove();
    statusLine();
  }
  function updateTiles(){
    [...$('multiviewGrid').querySelectorAll('.mv-tile')].forEach(t=>{
      const row=active(t.dataset.key),info=t.querySelector('.mv-state');
      if(info&&row)info.textContent=row.meta+' · '+row.status.toUpperCase();
    });
  }
  function addManual(){
    const url=$('mvStreamUrl').value.trim(),title=$('mvStreamTitle').value.trim(),parsed=stream(url);
    if(!parsed){note('Use a public Twitch channel/VOD or a YouTube watch/live link over HTTPS.');return;}
    const key='manual:'+parsed.provider+':'+parsed.id;
    if(!S.manual.some(x=>x.key===key))S.manual.push({key,url:parsed.url,provider:parsed.provider,title:title.slice(0,80)||parsed.id});
    if(!S.selected.includes(key)){
      if(S.selected.length>=LIMIT){note('Channel saved. Remove one of the eight streams before adding it to the grid.');}
      else S.selected.push(key);
    }
    $('mvStreamUrl').value='';$('mvStreamTitle').value='';
    note('Saved '+(title||parsed.id)+' to this browser.');save();mountPicker();renderGrid();
  }
  async function load(first){
    if(S.loading)return;S.loading=true;
    try{
      const [sources,games,teams]=await Promise.all([
        db.from('tournament_automation_sources').select('id,provider,url,display_label,active,public_visible,metadata').eq('active',true).eq('public_visible',true),
        db.from('esports_games').select('id,event_id,home_team_id,away_team_id,scheduled_at,status,stream_url,stream_provider,home_score,away_score').in('status',['live','scheduled']).not('stream_url','is',null).limit(200),
        db.from('esports_teams').select('id,name').limit(150)
      ]);
      if(sources.error||games.error||teams.error)throw(sources.error||games.error||teams.error);
      const teamNames=new Map((teams.data||[]).map(t=>[t.id,t.name]));
      (sources.data||[]).forEach(s=>{
        const p=stream(s.url);if(!p)return;
        S.channels.set('source:'+s.id,{key:'source:'+s.id,title:s.display_label||s.metadata?.title||'Live channel',url:p.url,provider:p.provider,status:'live',meta:'Network feed'});
      });
      (games.data||[]).forEach(g=>{
        const p=stream(g.stream_url);if(!p)return;
        const key='game:'+g.id,title=(teamNames.get(g.home_team_id)||'TBD')+' vs '+(teamNames.get(g.away_team_id)||'TBD');
        S.channels.set(key,{key,title,url:p.url,provider:p.provider,status:g.status||'scheduled',meta:g.status==='live'?'GAME LIVE '+(g.home_score??'')+'-'+(g.away_score??''):'Scheduled game'});
      });
      if(first&&!S.selected.length&&S.auto){
        S.selected=all().filter(x=>x.status==='live'&&!x.key.startsWith('manual:')).slice(0,4).map(x=>x.key);
      }
      S.updated=Date.now();S.auto=false;save();mountPicker();updateTiles();renderGrid();note('');
    }catch(e){console.error('Multiview refresh error',e);note('Live feed list could not refresh. Already-open players remain running. Retry below.');}
    finally{S.loading=false;}
  }
  readStore();fromQuery();
  $('mvAddStream')?.addEventListener('click',addManual);
  $('mvStreamUrl')?.addEventListener('keydown',e=>{if(e.key==='Enter')addManual();});
  $('mvColumns')?.addEventListener('change',()=>renderGrid());
  $('mvRefresh')?.addEventListener('click',()=>load(false));
  $('clearMultiview')?.addEventListener('click',()=>{S.selected=[];S.focused='';S.auto=false;save();mountPicker();renderGrid();});
  $('mvShare')?.addEventListener('click',()=>{
    const ids=S.selected.filter(x=>!x.startsWith('manual:'));
    const u=new URL(location.href);u.searchParams.set('streams',ids.join(','));
    (navigator.clipboard?.writeText(u.toString())||Promise.reject()).then(()=>note('Shareable network feeds link copied. Personal channels stay on this browser.')).catch(()=>note('Copy the current address to share network feeds.'));
  });
  renderGrid();load(true);
  setInterval(()=>{if(!document.hidden)load(false);},15000);
})();
