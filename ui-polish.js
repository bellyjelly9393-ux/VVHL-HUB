(() => {
  function themeText(text){
    const t=String(text||'').toLowerCase();
    if(t.includes('calgary hitmen')||t.includes('hitmen')) return 'hitmen';
    if(t.includes('wildman academy')) return 'academy';
    if(t.includes('wildman')) return 'wildman';
    return 'default';
  }
  function themeFor(el){ return themeText(el.closest('a,article,div')?.textContent||''); }
  function initials(name){
    const parts=String(name||'TEAM').trim().split(/\s+/).filter(Boolean);
    if(!parts.length)return'TM';
    return parts.map(x=>x[0]).join('').slice(0,3).toUpperCase();
  }
  function jersey(name){return `<span class="wm-mini-jersey" data-team-theme="${themeText(name)}" title="${String(name).replace(/["<>]/g,'')}">${initials(name)}</span>`;}
  function upgrade(){
    document.querySelectorAll('.network-team-mark:not(.wm-jersey-upgraded)').forEach(el=>{
      el.classList.add('wm-jersey-upgraded');
      el.dataset.teamTheme=themeFor(el);
      el.setAttribute('title',(el.textContent||'Team').trim()+' jersey mark');
    });
    document.querySelectorAll('.game-row:not(.wm-matchup-upgraded)').forEach(row=>{
      const matchup=row.children?.[1]?.querySelector('strong');
      if(!matchup)return;
      const text=matchup.textContent||'';
      const bits=text.split(/\s+vs\s+/i);
      if(bits.length!==2)return;
      row.classList.add('wm-matchup-upgraded');
      const visual=document.createElement('div');
      visual.className='wm-matchup-visual';
      visual.innerHTML=`${jersey(bits[0])}<span class="wm-mini-vs">VS</span>${jersey(bits[1])}`;
      matchup.insertAdjacentElement('beforebegin',visual);
    });
    document.querySelectorAll('.hub-tabs a:not(.wm-tab-upgraded)').forEach((a,i)=>{
      a.classList.add('wm-tab-upgraded');
      const text=(a.textContent||'').toLowerCase();
      const icon=text.includes('live')?'●':text.includes('report')?'✎':text.includes('player')?'♟':text.includes('team')?'⌂':text.includes('vod')?'▶':text.includes('game')?'◆':'›';
      a.insertAdjacentHTML('afterbegin',`<span class="wm-tab-icon" aria-hidden="true">${icon}</span>`);
    });
  }
  const observer=new MutationObserver(upgrade);
  const start=()=>{upgrade();observer.observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();