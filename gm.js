const CAP = 30;
const data = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];
const targetList = document.getElementById('targetList');
const boardEmpty = document.getElementById('boardEmpty');
const datalist = document.getElementById('playerNames');
const quickPlayer = document.getElementById('quickPlayer');
const notes = document.getElementById('gmNotes');

const getTeam = r => r[1] === 'S' ? (r[11] || '') : (r[8] || '');
const getBoard = () => { try { return JSON.parse(localStorage.getItem('vvhl-gm-board') || '[]'); } catch { return []; } };
const saveBoard = b => localStorage.setItem('vvhl-gm-board',JSON.stringify(b));
const money = n => `$${Number(n||0).toFixed(1)}M`;

function populateNames(){
  const names=[...new Set(data.map(r=>r[0]))].sort((a,b)=>a.localeCompare(b));
  datalist.innerHTML=names.map(n=>`<option value="${n.replaceAll('"','&quot;')}">`).join('');
}

function addByName(name){
  const r=data.find(x=>x[0].toLowerCase()===name.trim().toLowerCase());
  if(!r) return;
  const key=`${r[0]}|${r[1]}`;
  const board=getBoard();
  if(!board.some(x=>x.key===key)) board.push({key,name:r[0],type:r[1],position:r[2],team:getTeam(r),bid:0,note:''});
  saveBoard(board); quickPlayer.value=''; render();
}

function updateBid(key,value){
  const board=getBoard(); const row=board.find(x=>x.key===key); if(row) row.bid=Math.max(0,Number(value)||0); saveBoard(board); renderSummary(board);
}
function updateNote(key,value){ const board=getBoard(); const row=board.find(x=>x.key===key); if(row) row.note=value; saveBoard(board); }
function removeTarget(key){ saveBoard(getBoard().filter(x=>x.key!==key)); render(); }

function rowHtml(x){
  return `<div class="target-row"><div class="target-name"><b>${x.name}</b><small>${x.team || 'VVHL'} · ${x.position || (x.type==='G'?'Goalie':'Skater')}</small></div><div class="target-pos"><input class="text-input" data-note="${x.key}" value="${(x.note||'').replaceAll('"','&quot;')}" placeholder="Role"></div><div><input class="money-input" data-bid="${x.key}" type="number" min="0" max="30" step="0.1" value="${Number(x.bid||0)}" aria-label="Max bid for ${x.name}"></div><button class="remove-btn" data-remove="${x.key}" type="button">✕</button></div>`;
}

function renderSummary(board){
  const spend=board.reduce((s,x)=>s+(Number(x.bid)||0),0); const rem=CAP-spend; const avg=board.length?Math.max(0,rem)/board.length:0;
  document.getElementById('plannedSpend').textContent=money(spend);
  document.getElementById('capRemaining').textContent=money(rem);
  document.getElementById('targetCount').textContent=board.length;
  document.getElementById('sideSpend').textContent=money(spend);
  document.getElementById('sideRemaining').textContent=money(rem);
  document.getElementById('avgRoom').textContent=money(avg);
  const pct=Math.min(100,Math.max(0,(spend/CAP)*100)); const fill=document.getElementById('capFill'); fill.style.width=`${pct}%`; fill.classList.toggle('over',spend>CAP);
  const line=document.getElementById('remainingLine'); line.classList.toggle('over',rem<0); line.classList.toggle('remaining',rem>=0);
}

function render(){
  const board=getBoard(); targetList.innerHTML=board.map(rowHtml).join(''); boardEmpty.hidden=board.length>0; renderSummary(board);
  targetList.querySelectorAll('[data-bid]').forEach(el=>el.addEventListener('input',()=>updateBid(el.dataset.bid,el.value)));
  targetList.querySelectorAll('[data-note]').forEach(el=>el.addEventListener('input',()=>updateNote(el.dataset.note,el.value)));
  targetList.querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',()=>removeTarget(el.dataset.remove)));
}

document.getElementById('quickAdd').addEventListener('click',()=>addByName(quickPlayer.value));
quickPlayer.addEventListener('keydown',e=>{if(e.key==='Enter') addByName(quickPlayer.value);});
document.getElementById('clearBoard').addEventListener('click',()=>{if(confirm('Clear the entire GM target board?')){saveBoard([]);render();}});
notes.value=localStorage.getItem('vvhl-gm-notes')||''; notes.addEventListener('input',()=>localStorage.setItem('vvhl-gm-notes',notes.value));
document.getElementById('exportBoard').addEventListener('click',async()=>{
  const board=getBoard(); const spend=board.reduce((s,x)=>s+(Number(x.bid)||0),0); const lines=['VVHL GM BIDDING BOARD',`Planned spend: ${money(spend)} / $30.0M`,`Remaining: ${money(CAP-spend)}`,'',...board.map((x,i)=>`${i+1}. ${x.name} — ${x.position} — max ${money(x.bid)}${x.note?` — ${x.note}`:''}`)];
  try{await navigator.clipboard.writeText(lines.join('\n'));document.getElementById('exportBoard').textContent='Copied ✓';setTimeout(()=>document.getElementById('exportBoard').textContent='Copy Board Summary',1600);}catch{alert(lines.join('\n'));}
});
populateNames(); render();
