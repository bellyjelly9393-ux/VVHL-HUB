(() => {
  function themeFor(el){
    const text=(el.closest('a,article,div')?.textContent||'').toLowerCase();
    if(text.includes('calgary hitmen')||text.includes('hitmen')) return 'hitmen';
    if(text.includes('wildman academy')) return 'academy';
    if(text.includes('wildman')) return 'wildman';
    return 'default';
  }
  function upgrade(){
    document.querySelectorAll('.network-team-mark:not(.wm-jersey-upgraded)').forEach(el=>{
      el.classList.add('wm-jersey-upgraded');
      el.dataset.teamTheme=themeFor(el);
      el.setAttribute('title',(el.textContent||'Team').trim()+' jersey mark');
    });
  }
  const observer=new MutationObserver(upgrade);
  const start=()=>{upgrade();observer.observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();