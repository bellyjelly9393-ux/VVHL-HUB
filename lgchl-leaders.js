(()=>{'use strict';
const $=id=>document.getElementById(id),CGY=412;
const db=window.supabase?.createClient('https://lrgllzvwgvqagcpiyvfd.supabase.co','sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP');
if(!db)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString(),data={metric:'points'};
function table(headers,rows){
 return '<table><thead><tr>'+headers.map(t=>'<th>'+esc(t)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
}
function playerRow(p,rank,metric){
 let v=p[metric];if(metric==='save_pct')v=(100*Number(v||0)).toFixed(1)+'%';else if(metric==='gaa')v=Number(v||0).toFixed(2);else v=fmt(v);
 return '<tr class="'+(p.lg_team_id===CGY?'is-calgary':'')+'"><td>'+rank+'</td><td><b>'+esc(p.gamertag)+'</b><small>'+esc(p.position)+'</small></td><td>'+esc(p.team_name||'Unknown team')+'</td><td>'+fmt(p.gp)+'</td><td><b>'+esc(v)+'</b></td></tr>';
}
async function players(){
 const metric=$('lgMetric').value,goalie=['save_pct','gaa'].includes(metric);
 const base=()=>db.from('wm_lgchl_s55_player_leaders').select('gamertag,position,player_kind,lg_team_id,team_name,gp,points,goals,assists,shots,hits,blocked_shots,takeaways,save_pct,gaa,fetched_at').eq('player_kind',goalie?'goalie':'skater');
 const q=base().order(metric,{ascending:metric==='gaa'}).limit(20);
 const c=base().eq('lg_team_id',CGY).order(metric,{ascending:metric==='gaa'}).limit(20);
 if(goalie){q.gte('gp',4);c.gte('gp',4);}
 const [r,h]=await Promise.all([q,c]);if(r.error||h.error)throw(r.error||h.error);
 const head=['Rank','Player','Team','GP',metric.toUpperCase()];
 const players=r.data||[],cal=h.data||[];
 $('lgLeaders').innerHTML=table(head,players.map((p,i)=>playerRow(p,i+1,metric)));
 $('lgHitmen').innerHTML=cal.length?table(['Calgary','Player','Team','GP',metric.toUpperCase()],cal.map((p,i)=>playerRow(p,i+1,metric))):'<p>No Calgary players with qualifying data for this metric.</p>';
 data.metric=metric;
 const dates=[...players,...cal].map(x=>x.fetched_at).filter(Boolean).sort();
 if(dates.length)$('lgLastUpdated').textContent='Latest player import: '+new Date(dates[dates.length-1]).toLocaleString()+' · LGCHL Season 55 regular season.';
}
function powerScore(s){
 const gp=Math.max(1,Number(s.gp||1)),pts=Number(s.pts||0),gf=Number(s.gf||0),ga=Number(s.ga||0);
 return 100*(.70*Math.min(1,pts/(2*gp))+.20*Math.max(0,Math.min(1,((gf-ga)/gp+3)/6))+.10*Math.max(0,Math.min(1,(gf/gp)/6)));
}
async function power(){
 const [snap,teams]=await Promise.all([db.from('lgchl_standings_snapshots').select('lg_team_id,gp,w,l,otl,pts,gf,ga,taken_at').eq('season',55).order('taken_at',{ascending:false}).limit(1000),db.from('lgchl_teams').select('lg_team_id,name').eq('season',55)]);
 if(snap.error||teams.error)throw(snap.error||teams.error);
 const names=new Map((teams.data||[]).map(t=>[t.lg_team_id,t.name]));
 const seen=new Map();(snap.data||[]).forEach(s=>{if(!seen.has(s.lg_team_id))seen.set(s.lg_team_id,s);});
 const rank=[...seen.values()].filter(s=>s.gp>=5).map(s=>({...s,name:names.get(s.lg_team_id)||String(s.lg_team_id),score:powerScore(s)})).sort((a,b)=>b.score-a.score||b.pts-a.pts);
 const shown=rank.slice(0,20),cgy=rank.find(x=>x.lg_team_id===CGY);
 if(cgy&&!shown.includes(cgy))shown.push(cgy);
 $('lgPower').innerHTML=table(['Rank','Team','Record','Points','GF–GA','Index'],shown.map(s=>'<tr class="'+(s.lg_team_id===CGY?'is-calgary':'')+'"><td>'+(rank.indexOf(s)+1)+'</td><td><b>'+esc(s.name)+'</b></td><td>'+fmt(s.w)+'-'+fmt(s.l)+'-'+fmt(s.otl)+'</td><td>'+fmt(s.pts)+'</td><td>'+fmt(s.gf)+'–'+fmt(s.ga)+'</td><td><b>'+s.score.toFixed(1)+'</b></td></tr>'));
 const dates=[...seen.values()].map(x=>x.taken_at).sort();
 if(dates.length)$('lgPower').insertAdjacentHTML('afterend','<p class="mv-hint">Standings snapshot: '+esc(new Date(dates[dates.length-1]).toLocaleString())+'. Model rankings change as official standings refresh.</p>');
}
async function load(){try{await Promise.all([players(),power()]);}catch(e){console.error('LG leaderboard load',e);$('lgLeaders').textContent='Statistics unavailable. Reload to retry.';$('lgPower').textContent='Standings unavailable. Reload to retry.';}}
$('lgMetric').addEventListener('change',()=>players().catch(e=>{$('lgLeaders').textContent='Could not load this metric.';console.error(e);}));
$('lgReload').addEventListener('click',()=>location.reload());
load();
})();