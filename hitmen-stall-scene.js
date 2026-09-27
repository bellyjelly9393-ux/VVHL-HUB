/* Hitmen photo stall: renders the locker stall art with live nameplate + jersey print. */
(() => {
const ART={front:'assets/hitmen/stall-front.webp',back:'assets/hitmen/stall-back.webp',empty:'assets/hitmen/stall-empty.webp'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const q=(root,s)=>root.querySelector(s);

function markup(opts={}){
 const empty=!!opts.empty,mini=!!opts.mini;
 const imgs=empty
  ?'<img class="hs-img hs-front" src="'+ART.empty+'" alt="Open Hitmen locker stall" decoding="async"'+(mini?' loading="lazy"':'')+'>'
  :'<img class="hs-img hs-front" src="'+ART.front+'" alt="Hitmen locker stall" decoding="async"'+(mini?' loading="lazy"':'')+'>'+(mini?'':'<img class="hs-img hs-back" src="'+ART.back+'" alt="" aria-hidden="true" decoding="async">');
 return '<div class="hs-stall'+(empty?' is-empty':'')+(mini?' hs-mini':'')+'">'+imgs+
  '<div class="hs-plate" aria-hidden="true"><span class="hs-num l"></span><strong class="hs-name"></strong><span class="hs-num r"></span></div>'+
  '<span class="hs-helmet" aria-hidden="true"></span><span class="hs-sleeve l" aria-hidden="true"></span><span class="hs-sleeve r" aria-hidden="true"></span>'+
  '<b class="hs-bname" aria-hidden="true"></b><b class="hs-bnum" aria-hidden="true"></b>'+
  '<span class="hs-open-tag">OPEN STALL</span>'+
  (mini?'':'<button class="hs-flip" type="button" aria-label="Flip jersey to view the back"></button><span class="hs-hint">TAP JERSEY TO VIEW BACK</span>')+
 '</div>';
}
function fit(el,maxPct){
 const stall=el.closest('.hs-stall');if(!stall)return;
 el.style.transform='translate(-50%,-50%)';
 const max=stall.clientWidth*maxPct,w=el.scrollWidth;
 if(max&&w>max)el.style.transform='translate(-50%,-50%) scaleX('+(max/w).toFixed(3)+')';
}
function fitAll(stall){
 const empty=stall.classList.contains('is-empty');
 const n=q(stall,'.hs-name');if(n)fit(n,empty?.3:.29);
 const b=q(stall,'.hs-bname');if(b)fit(b,.34);
}
function update(host,{name='',number='',empty}={}){
 const stall=host.classList?.contains('hs-stall')?host:q(host,'.hs-stall');if(!stall)return;
 if(typeof empty==='boolean'&&empty!==stall.classList.contains('is-empty')){
  const mini=stall.classList.contains('hs-mini');host.innerHTML=markup({empty,mini});bind(host);return update(host,{name,number});
 }
 const N=String(name||'').toUpperCase(),D=String(number||'').replace(/\D/g,'').slice(0,2);
 q(stall,'.hs-name').textContent=N;
 stall.querySelectorAll('.hs-num,.hs-sleeve,.hs-helmet').forEach(e=>e.textContent=D);
 q(stall,'.hs-bname').textContent=N;q(stall,'.hs-bnum').textContent=D;
 requestAnimationFrame(()=>fitAll(stall));
 if(document.fonts?.ready)document.fonts.ready.then(()=>fitAll(stall));
}
function setBack(stall,back){
 stall.classList.toggle('is-back',back);
 const btn=q(stall,'.hs-flip'),hint=q(stall,'.hs-hint');
 if(btn)btn.setAttribute('aria-label',back?'Flip jersey to view the front':'Flip jersey to view the back');
 if(hint)hint.textContent=back?'TAP JERSEY TO VIEW FRONT':'TAP JERSEY TO VIEW BACK';
}
function bind(host){
 const stall=q(host,'.hs-stall')||host;
 q(stall,'.hs-flip')?.addEventListener('click',e=>{e.preventDefault();setBack(stall,!stall.classList.contains('is-back'))});
 if(window.ResizeObserver){const ro=new ResizeObserver(()=>fitAll(stall));ro.observe(stall);}
}
function mount(host,opts={}){host.innerHTML=markup(opts);bind(host);update(host,opts);return host;}
window.HitmenStall={markup,mount,update,setBack,fitAll,ART};
})();
