(() => {
const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const db=window.supabase?.createClient(URL,KEY); if(!db)return;
const E=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function twitchChannel(raw){try{const u=new URL(raw);return u.pathname.split('/').filter(Boolean).pop()||''}catch{return String(raw||'').split('/').filter(Boolean).pop()||''}}
function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const p=u.pathname.split('/').filter(Boolean),i=p.findIndex(x=>x==='embed'||x==='live');return i>=0?p[i+1]||'':''}catch{return ''}}
function channelFamily(value){
 const key=String(value||'').trim().toLowerCase();
 if(key==='hitmen'||key.startsWith('hitmen-'))return 'hitmen';
 if(key==='wildman'||key.startsWith('wildman-'))return 'wildman';
 return key;
}
function obsStage(channel){
 return `<iframe src="public-broadcast-stage.html?channel=${encodeURIComponent(channel)}" allow="autoplay; fullscreen" allowfullscreen title="EliteChel live broadcast"></iframe>`;
}
function embed(source){
 const family=channelFamily(source?.metadata?.channel_key||'');
 if(family==='hitmen') return obsStage('hitmen-main');
 const p=String(source.provider||'').toLowerCase();
 if(p==='twitch'){const ch=twitchChannel(source.url);return ch?`<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false" allowfullscreen title="${esc(source.display_label||'Twitch stream')}"></iframe>`:''}
 if(p==='youtube'){const id=youtubeId(source.url);return id?`<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${esc(source.display_label||'YouTube stream')}"></iframe>`:''}
 return '';
}
async function load(){
 const q=new URLSearchParams(location.search),id=q.get('source'),channel=q.get('channel');
 let req=db.from('tournament_automation_sources').select('*').eq('active',true).eq('public_visible',true);
 if(id) req=req.eq('id',id);
 const r=id?await req.maybeSingle():await req.order('slot_order');
 if(r.error){E('channelPlayer').innerHTML='<div class="featured-placeholder"><div><strong>Channel unavailable</strong><p>'+esc(r.error.message)+'</p></div></div>';return}
 let source=id?r.data:(r.data||[]).find(s=>String(s.metadata?.channel_key||'')===String(channel||'wildman'))||(r.data||[])[0];
 if(!source){E('channelPlayer').innerHTML='<div class="featured-placeholder"><div><strong>No channel found</strong><p>This public broadcast source is not configured.</p></div></div>';return}
 const family=channelFamily(source.metadata?.channel_key||channel||'');
 const isHitmen=family==='hitmen';
 const title=isHitmen?'Calgary Hitmen Live':(source.display_label||'Wildman Network Live');
 const group=source.metadata?.channel_group||'Wildman Network';
 document.title=title+' | Wildman Network';
 E('channelTitle').textContent=title;
 E('channelSubtitle').textContent=isHitmen?'EliteChel broadcast output · controlled by Hitmen Broadcast Studio':group+' · live broadcast channel';
 E('channelMetaTitle').textContent=title;
 E('channelProvider').textContent=isHitmen?'ELITE MEDIA OBS':String(source.provider||'stream').toUpperCase();
 let externalUrl=source.url;
 if(isHitmen){
   const state=await db.from('obs_broadcast_state').select('payload').eq('channel','hitmen-main').maybeSingle();
   externalUrl=state.data?.payload?.streamUrl||source.url;
   E('channelExternal').textContent='Open Source Stream';
 }
 E('channelExternal').href=externalUrl;
 E('channelMulti').href=isHitmen?'game-center.html?channel=hitmen':'multiview.html?streams='+encodeURIComponent('source:'+source.id);
 const player=embed(source);
 E('channelPlayer').innerHTML=player||`<div class="featured-placeholder"><div><strong>External broadcast</strong><p>This provider opens outside the embedded viewer.</p><a class="btn btn-primary" href="${esc(source.url)}" target="_blank" rel="noopener">Open Stream</a></div></div>`;
}
load();
})();