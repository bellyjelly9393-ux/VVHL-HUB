const players=Array.isArray(window.VVHL_PLAYERS)?window.VVHL_PLAYERS:[];
const $=id=>document.getElementById(id),grid=$('playerGrid'),modal=$('playerModal');
const search=$('searchInput'),typeFilter=$('typeFilter'),positionFilter=$('positionFilter');
let active=null;
const team=r=>r[1]==='S'?(r[11]||''):(r[8]||'');
const pos=r=>r[2]||(r[1]==='G'?'Goalie':'Unknown');
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pg=(v,g)=>g?Number(v)/Number(g):0;
const clamp=v=>Math.max(0,Math.min(100,Math.round(v)));
const scale=(v,a,b)=>clamp((v-a)/(b-a)*100);
const board=()=>{try{return JSON.parse(localStorage.getItem('vvhl-gm-board')||'[]')}catch{return[]}};
const save=v=>localStorage.setItem('vvhl-gm-board',JSON.stringify(v));
const winRate=s=>{const [w=0,l=0,o=0]=String(s||'').split('-').map(Number);return w+l+o?w/(w+l+o):0};
const confidence=g=>g>=24?['High confidence','high']:g>=12?['Moderate confidence','medium']:['Small sample','low'];
const initials=n=>{const p=n.trim().split(/\s+/);return((p[0]?.[0]||'?')+(p.length>1?p.at(-1)[0]:(p[0]?.[1]||''))).toUpperCase()};

function skaterReport(r){
 const g=+r[3]||0,p=+r[4]||0,goals=+r[7]||0,assists=+r[8]||0,pm=+r[9]||0,fo=+r[10]||0;
 const ppg=pg(p,g),gpg=pg(goals,g),apg=pg(assists,g),pmg=pg(pm,g),wr=winRate(r[6]),position=pos(r);
 let arch='Two-Way Skater';
 if(position==='Center')arch=fo>=55?'Faceoff Two-Way Center':apg>gpg*1.15?'Pass-First Playmaker':gpg>=1.5?'Scoring Center':'Two-Way Center';
 else if(position==='Left Wing')arch=gpg>=1.8||goals>assists*1.35?'Goal-Scoring Winger':assists>goals*1.15?'Playmaking Winger':pmg>=1?'Two-Way Winger':'Offensive Winger';
 else if(position.includes('Defense'))arch=apg>=2.5?'Puck-Moving Defenseman':pmg>=1.25?'Two-Way Defenseman':assists>goals*2.5?'Transition Defenseman':'Defensive Defenseman';
 const good=[],risk=[];
 if(ppg>=5)good.push(`Elite production at ${ppg.toFixed(2)} points per game.`);else if(ppg>=3.5)good.push(`Strong production rate of ${ppg.toFixed(2)} points per game.`);else if(ppg<2.25)risk.push(`Limited current production at ${ppg.toFixed(2)} points per game.`);
 if(gpg>=1.75)good.push(`High-end goal output at ${gpg.toFixed(2)} per game.`);
 if(apg>=2.5)good.push(`Strong distribution results at ${apg.toFixed(2)} assists per game.`);
 if(pmg>=1)good.push(`Positive team results while dressed (${pm>=0?'+':''}${pm}).`);else if(pmg<=-.75)risk.push(`The ${pm} rating needs lineup and opponent context.`);
 if(position==='Center'&&fo>=55)good.push(`Reliable faceoff results at ${fo.toFixed(1)}%.`);else if(position==='Center'&&fo<47)risk.push(`Faceoff rate of ${fo.toFixed(1)}% is below the preferred center range.`);
 if(wr>=.65)good.push(`Strong ${r[6]} game record.`);else if(wr<.4)risk.push(`The ${r[6]} record requires closer role and lineup review.`);
 if(g<12)risk.push(`Only ${g} games played; projection carries significant sample risk.`);
 if(!good.length)good.push('Balanced statistical profile without one category dominating.');
 if(!risk.length)risk.push('No major statistical warning; VOD is still required to confirm play style.');
 return{arch,good,risk,grades:[['Production',scale(ppg,1.25,6.5)],['Finishing',scale(gpg,.25,3)],['Playmaking',scale(apg,.5,3.75)],['Team Results',scale(pmg,-3,3)],['Winning',scale(wr,.2,.8)]],summary:`${arch} with ${p} points in ${g} games (${ppg.toFixed(2)} per game). The ${pm>=0?'+':''}${pm} rating and ${r[6]} record provide the current team-results context. This is a statistical projection pending game-log and VOD confirmation.`};
}

function goalieReport(r){
 const g=+r[3]||0,sv=+r[4]||0,gaa=+r[5]||0,so=+r[7]||0,wr=winRate(r[6]);
 const arch=sv>=.76?'High-Efficiency Goaltender':gaa<=4.75?'Low-Event Goaltender':g>=22?'Volume Starter':'Developing Goaltender',good=[],risk=[];
 if(sv>=.76)good.push(`Excellent ${sv.toFixed(3)} save percentage.`);else if(sv>=.72)good.push(`Competitive ${sv.toFixed(3)} save percentage.`);else risk.push(`The ${sv.toFixed(3)} save percentage is below the top-performing range.`);
 if(gaa<=4.75)good.push(`${gaa.toFixed(2)} GAA supports strong suppression results.`);else if(gaa>=6.5)risk.push(`${gaa.toFixed(2)} GAA needs defensive-system and shot-quality context.`);
 if(wr>=.65)good.push(`Strong ${r[6]} record.`);else if(wr<.4)risk.push(`The ${r[6]} record increases projection risk.`);
 if(so)good.push(`${so} shutout${so===1?'':'s'} demonstrate game-stealing upside.`);
 if(g<12)risk.push(`Only ${g} appearances; treat this as a small sample.`);
 if(!good.length)good.push('Provides a usable statistical baseline for VOD review.');
 if(!risk.length)risk.push('No major statistical warning; rebound control and save selection require VOD.');
 return{arch,good,risk,grades:[['Save Efficiency',scale(sv,.58,.82)],['Goals Against',scale(gaa,8.5,3)],['Winning',scale(wr,.15,.8)],['Workload',scale(g,3,28)],['Shutout Value',scale(so,0,2)]],summary:`${arch} with a ${sv.toFixed(3)} save percentage, ${gaa.toFixed(2)} GAA and ${r[6]} record through ${g} appearances. Team defense and shot quality are not yet available, so this remains a statistical projection pending VOD.`};
}
const report=r=>r[1]==='G'?goalieReport(r):skaterReport(r);
const detail=(a,b)=>`<div class="detail"><small>${esc(a)}</small><b>${esc(b??'—')}</b></div>`;
const find=k=>players.find(r=>`${r[0]}|${r[1]}`===k);

function add(r){
 const b=board(),key=`${r[0]}|${r[1]}`;
 if(!b.some(x=>x.key===key)){b.push({key,name:r[0],type:r[1],position:pos(r),team:team(r),bid:0,note:''});save(b)}
 counts();document.querySelectorAll('[data-add]').forEach(x=>{if(x.dataset.add===key){x.textContent='Added ✓';x.disabled=true}});
 if(active===r)$('modalAdd').textContent='Added to GM Board ✓';
}
function tab(name){document.querySelectorAll('.profile-tab').forEach(x=>x.classList.toggle('active',x.dataset.profileTab===name));document.querySelectorAll('.profile-panel').forEach(x=>x.classList.toggle('active',x.dataset.profilePanel===name))}
function openPlayer(r,setUrl=true){
 active=r;const rp=report(r),cf=confidence(+r[3]||0),key=`${r[0]}|${r[1]}`;
 $('modalTitle').textContent=r[0];$('modalMeta').textContent=`${team(r)||'VVHL Season XI'} · ${r[6]||'No record'}`;
 $('modalPosition').textContent=pos(r);$('modalPosition').dataset.position=pos(r);$('modalArchetype').textContent=rp.arch;
 $('modalConfidence').textContent=cf[0];$('modalConfidence').className=`confidence-chip ${cf[1]}`;$('profileMonogram').textContent=initials(r[0]);
 $('modalDetails').innerHTML=r[1]==='S'?detail('Games',r[3])+detail('Overall',r[5])+detail('Points',r[4])+detail('Goals',r[7])+detail('Assists',r[8])+detail('+ / -',r[9])+detail('Faceoff %',r[10]+'%')+detail('Record',r[6]):detail('Games',r[3])+detail('Record',r[6])+detail('Save %',r[4])+detail('GAA',r[5])+detail('Shutouts',r[7])+detail('Role','Goalie');
 $('reportSummary').textContent=rp.summary;$('reportGrades').innerHTML=rp.grades.map(([a,v])=>`<div class="grade-row"><span>${esc(a)}</span><div class="grade-track"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('');
 $('reportStrengths').innerHTML=rp.good.map(x=>`<li>${esc(x)}</li>`).join('');$('reportConcerns').innerHTML=rp.risk.map(x=>`<li>${esc(x)}</li>`).join('');
 $('modalAdd').textContent=board().some(x=>x.key===key)?'Added to GM Board ✓':'Add to GM Board';tab('overview');modal.classList.add('open');document.body.style.overflow='hidden';
 if(setUrl){const u=new URL(location.href);u.searchParams.set('player',r[0]);u.searchParams.set('type',r[1]);history.replaceState({},'',u)}
}
function closePlayer(){modal.classList.remove('open');document.body.style.overflow='';active=null;const u=new URL(location.href);u.searchParams.delete('player');u.searchParams.delete('type');history.replaceState({},'',u)}
function card(r){
 const g=r[1]==='G',key=`${r[0]}|${r[1]}`,rp=report(r),cf=confidence(+r[3]||0),added=board().some(x=>x.key===key);
 const stats=g?[['GP',r[3]],['SV%',r[4]],['GAA',r[5]],['SO',r[7]]]:[['GP',r[3]],['PTS',r[4]],['OVR',r[5]],['+/-',r[9]]];
 return `<article class="player-card ${g?'goalie':''}" data-card="${esc(key)}" tabindex="0" role="button"><div class="player-head"><div><h3>${esc(r[0])}</h3><div class="player-meta">${esc(pos(r))} · ${esc(r[6]||'Season XI')}</div></div><span class="player-type">${g?'Goalie':'Skater'}</span></div><div class="player-team">${esc(team(r)||'VVHL Season XI')}</div><div class="card-archetype">${esc(rp.arch)} <small>${esc(cf[0])}</small></div><div class="player-stats">${stats.map(([a,b])=>`<div class="mini-stat"><small>${a}</small><b>${esc(b)}</b></div>`).join('')}</div><div class="card-actions"><button class="small-btn" data-view="${esc(key)}" type="button">Full Report</button><button class="small-btn primary" data-add="${esc(key)}" type="button" ${added?'disabled':''}>${added?'Added ✓':'Add to GM'}</button></div></article>`;
}
function filtered(){const q=search.value.trim().toLowerCase();return players.filter(r=>{const h=`${r[0]} ${team(r)} ${pos(r)} ${report(r).arch}`.toLowerCase();return(!q||h.includes(q))&&(typeFilter.value==='all'||r[1]===typeFilter.value)&&(positionFilter.value==='all'||pos(r)===positionFilter.value)}).sort((a,b)=>a[0].localeCompare(b[0]))}
function render(){const rows=filtered();grid.innerHTML=rows.map(card).join('');$('emptyState').hidden=!!rows.length;grid.querySelectorAll('[data-view]').forEach(x=>x.onclick=e=>{e.stopPropagation();openPlayer(find(x.dataset.view))});grid.querySelectorAll('[data-add]').forEach(x=>x.onclick=e=>{e.stopPropagation();add(find(x.dataset.add))});grid.querySelectorAll('[data-card]').forEach(x=>{x.onclick=()=>openPlayer(find(x.dataset.card));x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();x.click()}}})}
function counts(){$('totalPlayers').textContent=players.length;$('skaterCount').textContent=players.filter(x=>x[1]==='S').length;$('goalieCount').textContent=players.filter(x=>x[1]==='G').length;$('shortlistCount').textContent=board().length}
[search,typeFilter,positionFilter].forEach(x=>x.oninput=render);document.querySelectorAll('.profile-tab').forEach(x=>x.onclick=()=>tab(x.dataset.profileTab));
$('modalClose').onclick=closePlayer;modal.onclick=e=>{if(e.target===modal)closePlayer()};document.onkeydown=e=>{if(e.key==='Escape'&&modal.classList.contains('open'))closePlayer()};
$('modalAdd').onclick=()=>active&&add(active);$('copyProfile').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('copyProfile').textContent='Link Copied ✓';setTimeout(()=>$('copyProfile').textContent='Copy Profile Link',1600)}catch{$('copyProfile').textContent='Copy Failed'}};
counts();render();const p=new URLSearchParams(location.search),wanted=p.get('player'),kind=p.get('type');if(wanted){const r=players.find(x=>x[0].toLowerCase()===wanted.toLowerCase()&&(!kind||x[1]===kind));if(r)openPlayer(r,false)}
