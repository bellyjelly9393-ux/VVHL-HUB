/* Wildman public stalls. Saving is enforced by database RLS, not these controls. */
(() => {
  const root = document.getElementById('wildmanCoreStalls');
  if (!root) return;
  const db = window.VVHLBackend?.db;
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows = [], editable = new Set(), manager = false, generation = 0;
  const message = document.getElementById('wildmanStallMessage');
  function card(row) {
    const id = row.player_id, canEdit = editable.has(id), isGoalie = /^(G|GOALIE|GOALTENDER)$/i.test(String(row.position || '').trim());
    return `<article class="wc-card${isGoalie ? ' wc-goalie-card' : ''}" data-player="${esc(id)}"><div class="wc-art" role="group" aria-label="${esc(row.gamertag)} ${isGoalie ? 'goalie locker stall with leg pads, catching glove, blocker, mask, and stick' : 'locker stall'}">
      <div class="wc-plate"><span class="wc-plate-name">${esc(row.jersey_name)}</span><span class="wc-plate-num">${esc(row.jersey_number)}</span></div>
      <span class="wc-helmet">${esc(row.jersey_number)}</span>${isGoalie ? '<img class="wc-goalie-kit" src="assets/wildman/stalls/goalie-kit.svg" alt="" aria-hidden="true" loading="lazy" decoding="async">' : ''}<b class="wc-print-name">${esc(row.jersey_name)}</b><b class="wc-print-number">${esc(row.jersey_number)}</b>
      <button class="wc-flip" type="button" aria-label="View back of ${esc(row.gamertag)} jersey" aria-pressed="false"></button><span class="wc-flip-label">TAP JERSEY · VIEW BACK</span></div>
      <div class="wc-details"><div class="wc-meta">WILDMAN HOCKEY · ${isGoalie ? 'GOALTENDER' : esc(row.position || 'PLAYER')}</div><h3>${esc(row.gamertag)}</h3>
      <div class="wc-tools"><button class="small-btn wc-flip-control" type="button" aria-pressed="false">View back</button><a class="small-btn" href="esports-player.html?id=${encodeURIComponent(id)}">Player profile ↗</a>${canEdit ? '<button class="small-btn wc-edit" type="button" aria-expanded="false">Customize jersey</button>' : '<span class="wc-status">View only</span>'}</div>
      ${canEdit ? `<form class="wc-form" hidden><label>Jersey name<input name="jersey_name" required maxlength="24" value="${esc(row.jersey_name)}" autocomplete="off"></label><label>Jersey number<input name="jersey_number" inputmode="numeric" pattern="[0-9]{0,2}" maxlength="2" value="${esc(row.jersey_number)}" autocomplete="off"></label><button class="small-btn" type="submit">Save jersey</button><button class="small-btn wc-cancel" type="button">Cancel</button></form>` : ''}
      ${manager ? `<details class="wc-manager"><summary>Manage Discord ownership</summary><p>Assign the player's numeric Discord user ID. This grants jersey editing only. Replacing the ID removes the previous owner's access.</p><label>Discord user ID<input class="wc-discord-id" inputmode="numeric" pattern="[0-9]{17,20}" aria-label="Discord user ID for ${esc(row.gamertag)}" placeholder="17–20 digit user ID"></label><button class="small-btn wc-bind" type="button">Assign Discord</button><button class="small-btn wc-unbind" type="button">Remove assignment</button></details>` : ''}
      <p class="wc-status" role="status" aria-live="polite"></p></div></article>`;
  }
  function print(card, name, number) {
    card.querySelector('.wc-plate-name').textContent = name;
    card.querySelector('.wc-print-name').textContent = name;
    card.querySelectorAll('.wc-plate-num,.wc-helmet,.wc-print-number').forEach(n => n.textContent = number);
  }
  function render() {
    root.innerHTML = rows.length ? rows.map(card).join('') : '<p class="wc-error">No Wildman stalls are available yet.</p>';
    document.getElementById('wildmanStallCount').textContent = `${rows.length} STALLS`;
    root.querySelectorAll('.wc-card').forEach(el => {
      const row = rows.find(r => r.player_id === el.dataset.player), status = el.querySelector('[role="status"]');
      const flip = () => {
        const back = el.querySelector('.wc-art').classList.toggle('is-back');
        el.querySelectorAll('.wc-flip,.wc-flip-control').forEach(button=>button.setAttribute('aria-pressed',String(back)));
        el.querySelector('.wc-flip-control').textContent=back?'View front':'View back';
        el.querySelector('.wc-flip').setAttribute('aria-label', `View ${back ? 'front' : 'back'} of ${row.gamertag} jersey`);
        el.querySelector('.wc-flip-label').textContent = `TAP JERSEY · VIEW ${back ? 'FRONT' : 'BACK'}`;
      };
      el.querySelector('.wc-flip').onclick=flip;
      el.querySelector('.wc-flip-control').onclick=flip;
      const form = el.querySelector('form'), edit = el.querySelector('.wc-edit');
      if (form) {
        edit.onclick = () => {form.hidden = !form.hidden; edit.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) form.elements.jersey_name.focus();};
        form.oninput = () => { print(el,form.elements.jersey_name.value.toUpperCase(),form.elements.jersey_number.value); status.textContent='Unsaved preview'; };
        el.querySelector('.wc-cancel').onclick = () => {form.reset();print(el,row.jersey_name,row.jersey_number);form.hidden=true;edit.setAttribute('aria-expanded','false');status.textContent='';};
        form.onsubmit = async e => {
          e.preventDefault();
          const patch = {jersey_name:form.elements.jersey_name.value.trim().toUpperCase(),jersey_number:form.elements.jersey_number.value.trim()};
          if (!patch.jersey_name || patch.jersey_name.length>24 || !/^[0-9]{0,2}$/.test(patch.jersey_number)) {status.textContent='Use a name up to 24 characters and a number from 0 to 99.';return;}
          const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Saving…';
          try {
            const {data,error}=await db.from('wildman_stalls').update(patch).eq('player_id',row.player_id).select('player_id,jersey_name,jersey_number').single();
            if(error || !data) throw new Error('Could not save. Your Discord account must be assigned to this stall.');
            Object.assign(row,data);print(el,row.jersey_name,row.jersey_number);form.elements.jersey_name.value=row.jersey_name;status.textContent='Jersey saved.';
          } catch(error) {status.textContent=error.message || 'Could not save. Try again.';} finally {button.disabled=false;}
        };
      }
      async function bind(discord,button) {
        button.disabled=true;status.textContent='Updating ownership…';
        try {const {error}=await db.rpc('bind_wildman_stall',{target:row.player_id,discord}); if(error) throw error;status.textContent=discord?'Discord assigned. This player can now sign in and customize their jersey.':'Assignment removed. Player editing is disabled.';}
        catch(error){status.textContent=error.code==='23505'?'That Discord account is already assigned to another stall.':(error.message || 'Could not update assignment.');} finally {button.disabled=false;}
      }
      el.querySelector('.wc-bind')?.addEventListener('click',e=>{const id=el.querySelector('.wc-discord-id').value.trim();if(!/^[0-9]{17,20}$/.test(id)){status.textContent='Enter the numeric Discord user ID, not a username.';return;}bind(id,e.currentTarget);});
      el.querySelector('.wc-unbind')?.addEventListener('click',e=>bind(null,e.currentTarget));
    });
  }
  async function load() {
    const version=++generation;
    editable=new Set();manager=false;if(rows.length)render();else{root.innerHTML='<p class="wc-status">Loading locker room…</p>';document.getElementById('wildmanStallCount').textContent='';}
    if(!db){message.textContent='Sign-in service unavailable. Please reload.';return;}
    try {
      const {data:stalls,error}=await db.from('wildman_stalls').select('player_id,jersey_name,jersey_number');if(error)throw error;
      const {data:players,error:pe}=await db.from('esports_players').select('id,gamertag,primary_position').in('id',stalls.map(s=>s.player_id));if(pe)throw pe;
      const user=window.VVHLBackend.state.user;
      const access=user?await db.rpc('wildman_stall_access'):{data:null};
      if(version!==generation)return;
      editable=new Set(access.error?[]:access.data?.editable||[]);manager=!access.error&&access.data?.manager===true;
      rows=stalls.map(s=>{const p=players.find(p=>p.id===s.player_id);return {...s,gamertag:p?.gamertag||s.jersey_name,position:p?.primary_position};}).sort((a,b)=>a.gamertag.localeCompare(b.gamertag));
      message.textContent=access.error?'Could not verify editing access. Please refresh.':user?(manager?'Management access · assign Discord accounts below.':editable.size?'Your stall is unlocked. Select Customize jersey.':'Signed in · ask management to assign your Discord user ID to your stall.'):'View every stall. Sign in with your assigned Discord account to customize yours.';
      document.getElementById('wildmanStallLogin').hidden=!!user;
      document.getElementById('wildmanStallLogout').hidden=!user;
      render();
    } catch(error){if(version!==generation)return;root.innerHTML='<p class="wc-error">Stalls could not load. Please refresh to try again.</p>';message.textContent='Editing is unavailable until access can be verified.';}
  }
  document.getElementById('wildmanStallLogin').onclick=async()=>{try{const {error}=await db.auth.signInWithOAuth({provider:'discord',options:{redirectTo:vvhlAuthRedirectUrl(),scopes:'identify email'}});if(error)throw error;}catch(e){message.textContent=e.message||'Discord sign-in unavailable.';}};
  document.getElementById('wildmanStallLogout').onclick=async()=>{editable.clear();manager=false;render();await db.auth.signOut();await window.VVHLBackend.refresh();};
  window.addEventListener('vvhl-auth-change',load);
  load();
})();
