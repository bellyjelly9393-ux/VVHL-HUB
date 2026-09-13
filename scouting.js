const allPlayers = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];
const grid = document.getElementById('playerGrid');
const searchInput = document.getElementById('searchInput');
const typeFilter = document.getElementById('typeFilter');
const positionFilter = document.getElementById('positionFilter');
const emptyState = document.getElementById('emptyState');
const modal = document.getElementById('playerModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalMeta = document.getElementById('modalMeta');
const modalDetails = document.getElementById('modalDetails');
const modalAdd = document.getElementById('modalAdd');
let activePlayer = null;

const getTeam = (r) => r[1] === 'S' ? (r[11] || '') : (r[8] || '');
const getPos = (r) => r[2] || (r[1] === 'G' ? 'Goalie' : 'Unknown');
const getBoard = () => { try { return JSON.parse(localStorage.getItem('vvhl-gm-board') || '[]'); } catch { return []; } };
const saveBoard = (v) => localStorage.setItem('vvhl-gm-board', JSON.stringify(v));
const fmt = (v, suffix='') => (v === undefined || v === null || v === '') ? '—' : `${v}${suffix}`;

function addToBoard(r) {
  const board = getBoard();
  const key = `${r[0]}|${r[1]}`;
  if (!board.some(x => x.key === key)) {
    board.push({ key, name:r[0], type:r[1], position:getPos(r), team:getTeam(r), bid:0, note:'' });
    saveBoard(board);
  }
  updateCounts();
  document.querySelectorAll(`[data-add="${CSS.escape(key)}"]`).forEach(b => { b.textContent='Added ✓'; b.disabled=true; });
  if (activePlayer && `${activePlayer[0]}|${activePlayer[1]}` === key) modalAdd.textContent='Added to GM Board ✓';
}

function detail(label,value){ return `<div class="detail"><small>${label}</small><b>${value}</b></div>`; }

function openPlayer(r) {
  activePlayer = r;
  const team = getTeam(r);
  modalTitle.textContent = r[0];
  modalMeta.textContent = `${getPos(r)} · ${team || 'Season XI League Database'} · ${r[6] || 'No record'}`;
  if (r[1] === 'S') {
    modalDetails.innerHTML = detail('Games',fmt(r[3]))+detail('OVR',fmt(r[5]))+detail('Points',fmt(r[4]))+detail('Goals',fmt(r[7]))+detail('Assists',fmt(r[8]))+detail('+ / -',fmt(r[9]))+detail('Faceoff %',fmt(r[10],'%'))+detail('Player Type','Skater');
  } else {
    modalDetails.innerHTML = detail('Games',fmt(r[3]))+detail('Record',fmt(r[6]))+detail('Save %',fmt(r[4]))+detail('GAA',fmt(r[5]))+detail('Shutouts',fmt(r[7]))+detail('Player Type','Goalie');
  }
  const key = `${r[0]}|${r[1]}`;
  modalAdd.textContent = getBoard().some(x => x.key === key) ? 'Added to GM Board ✓' : 'Add to GM Board';
  modal.classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModal(){ modal.classList.remove('open'); document.body.style.overflow=''; activePlayer=null; }

function playerCard(r){
  const goalie = r[1] === 'G';
  const team = getTeam(r);
  const key = `${r[0]}|${r[1]}`;
  const added = getBoard().some(x => x.key === key);
  const stats = goalie
    ? [["GP",r[3]],["SV%",r[4]],["GAA",r[5]],["SO",r[7]]]
    : [["GP",r[3]],["PTS",r[4]],["OVR",r[5]],["+/-",r[9]]];
  return `<article class="player-card ${goalie?'goalie':''}" data-key="${key.replaceAll('"','&quot;')}"><div class="player-head"><div><h3>${r[0]}</h3><div class="player-meta">${getPos(r)} · ${r[6] || 'Season XI'}</div></div><span class="player-type">${goalie?'Goalie':'Skater'}</span></div><div class="player-team">${team || 'VVHL Season XI'}</div><div class="player-stats">${stats.map(([a,b])=>`<div class="mini-stat"><small>${a}</small><b>${fmt(b)}</b></div>`).join('')}</div><div class="card-actions"><button class="small-btn" type="button" data-view="${key.replaceAll('"','&quot;')}">View Profile</button><button class="small-btn primary" type="button" data-add="${key.replaceAll('"','&quot;')}" ${added?'disabled':''}>${added?'Added ✓':'Add to GM'}</button></div></article>`;
}

function filteredPlayers(){
  const q = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const pos = positionFilter.value;
  return allPlayers.filter(r => {
    const hay = `${r[0]} ${getTeam(r)} ${getPos(r)}`.toLowerCase();
    return (!q || hay.includes(q)) && (type==='all' || r[1]===type) && (pos==='all' || getPos(r)===pos);
  }).sort((a,b) => a[0].localeCompare(b[0],undefined,{sensitivity:'base'}));
}

function render(){
  const rows = filteredPlayers();
  grid.innerHTML = rows.map(playerCard).join('');
  emptyState.hidden = rows.length > 0;
  grid.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.view; const r = allPlayers.find(x => `${x[0]}|${x[1]}`===key); if(r) openPlayer(r);
  }));
  grid.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.add; const r = allPlayers.find(x => `${x[0]}|${x[1]}`===key); if(r) addToBoard(r);
  }));
}

function updateCounts(){
  document.getElementById('totalPlayers').textContent = allPlayers.length;
  document.getElementById('skaterCount').textContent = allPlayers.filter(x=>x[1]==='S').length;
  document.getElementById('goalieCount').textContent = allPlayers.filter(x=>x[1]==='G').length;
  document.getElementById('shortlistCount').textContent = getBoard().length;
}

[searchInput,typeFilter,positionFilter].forEach(el=>el.addEventListener('input',render));
modalClose.addEventListener('click',closeModal); modal.addEventListener('click',e=>{if(e.target===modal) closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});
modalAdd.addEventListener('click',()=>{if(activePlayer) addToBoard(activePlayer);});
updateCounts(); render();
