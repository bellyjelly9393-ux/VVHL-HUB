/* War Room: "Tonight's Six" rink + photoreal Hitmen jerseys (port of the approved mockup rink.js).
   Neutral ice/boards/markings. Jerseys are content colour (real Calgary kit: black, red, white; no pink).
   Data comes from the caller (war-room-tonight.js); nothing here reads Supabase.
   WRRink.render(el,{players,scale,jersey,kit,small,labels})  players: [{pos,name,no,me,tag}]
   WRRink.tabs(host,rinkEl,{games,active,size:'sm'|'xs',rink:{...},playersFor(g),onChange(g)})
   WRRink.jersey(player,width,kit,bare) -> svg string                                                  */
(function(){
const A='assets/war-room/', CREST='assets/lgchl/s55/team412.png?v=20261004-broadcast';
// rink coordinates in feet (defensive zone through centre ice); jerseys frame the centre-ice logo
const XY={LW:[100,13],C:[74,42.5],RW:[100,71.5],LD:[47,21],RD:[47,64],G:[19,42.5]};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let uid=0;
function scuffs(){
  let seed=7,r=()=>(seed=(seed*16807)%2147483647)/2147483647,o='';
  for(let i=0;i<70;i++){const near=i<34;const cx=near?100+(r()-.5)*34:6+r()*118,cy=near?42.5+(r()-.5)*34:4+r()*77,len=3+r()*9,a=r()*6.283,bend=(r()-.5)*4;
    const x1=cx-Math.cos(a)*len/2,y1=cy-Math.sin(a)*len/2,x2=cx+Math.cos(a)*len/2,y2=cy+Math.sin(a)*len/2;
    o+=`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${(cx+bend).toFixed(1)} ${(cy-bend).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#F2F4F6" stroke-opacity="${(.05+r()*.09).toFixed(2)}" stroke-width="${(.1+r()*.18).toFixed(2)}"/>`;}
  return o;
}
const SCUFFS=scuffs();
function rinkSVG(id){
  const L='#50545A', B='#3A3E44';
  const boards='M128 0 H28 A28 28 0 0 0 0 28 V57 A28 28 0 0 0 28 85 H128';
  const circ=(cx,cy)=>`<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${L}" stroke-width=".28"/><circle cx="${cx}" cy="${cy}" r="1" fill="${L}"/>`+
    [[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy])=>`<line x1="${cx+sx*2.85}" y1="${cy+sy*14.7}" x2="${cx+sx*2.85}" y2="${cy+sy*16.8}" stroke="${L}" stroke-width=".28"/>`).join('')+
    [[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy])=>`<path d="M${cx+sx*1.5} ${cy+sy*3.5} V${cy+sy*.75} H${cx+sx*4.5}" fill="none" stroke="${L}" stroke-width=".22"/>`).join('');
  return `<svg class="ice" viewBox="-3 -3 134 91" preserveAspectRatio="none" aria-hidden="true"><defs>
  <pattern id="ip${id}" patternUnits="userSpaceOnUse" width="56" height="56"><image href="${A}ice-neutral.webp" width="56" height="56" preserveAspectRatio="xMidYMid slice"/></pattern>
  <radialGradient id="il${id}" cx="62%" cy="42%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".20"/><stop offset=".55" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></radialGradient>
  <linearGradient id="ifade${id}" x1="0" x2="1"><stop offset=".89" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="im${id}"><rect x="-3" y="-3" width="134" height="91" fill="url(#ifade${id})"/></mask>
  <filter id="ib${id}" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="saturate" values=".72"/><feGaussianBlur stdDeviation=".28"/></filter>
  <radialGradient id="ifr${id}"><stop offset="0" stop-color="#E8EBEE" stop-opacity=".05"/><stop offset=".7" stop-color="#E8EBEE" stop-opacity=".09"/><stop offset="1" stop-color="#E8EBEE" stop-opacity="0"/></radialGradient>
  <clipPath id="ic${id}"><path d="${boards} Z"/></clipPath></defs>
  <g mask="url(#im${id})">
  <path d="${boards}" fill="none" stroke="#050506" stroke-width="3.2" opacity=".8"/>
  <path d="${boards}" fill="none" stroke="#2C2E32" stroke-width="2.2"/>
  <g clip-path="url(#ic${id})">
    <rect x="0" y="0" width="128" height="85" fill="#C9CCCF"/>
    <rect x="0" y="0" width="128" height="85" fill="url(#ip${id})" opacity=".55"/>
    <rect x="0" y="0" width="128" height="85" fill="#1A1C1F" opacity=".46"/>
    <g class="ice-logo-g" filter="url(#ib${id})" opacity=".42"><image class="ice-logo" href="${CREST}" x="87" y="29.5" width="26" height="26" preserveAspectRatio="xMidYMid meet"/></g>
    <rect x="0" y="0" width="128" height="85" fill="url(#ip${id})" opacity=".28"/>
    <rect x="86" y="28.5" width="28" height="28" fill="url(#ifr${id})"/>
    ${SCUFFS}
    <path d="M11 31 L0 28 M11 54 L0 57" stroke="${L}" stroke-width=".28"/>
    <line x1="11" y1="0" x2="11" y2="85" stroke="${L}" stroke-width=".35"/>
    <path d="M11 36.5 A6 6 0 0 1 11 48.5 Z" fill="#D9DCE0" fill-opacity=".22" stroke="${L}" stroke-width=".28"/>
    <rect x="7.6" y="39.5" width="3.4" height="6" rx=".8" fill="rgba(255,255,255,.10)" stroke="#D4D7DA" stroke-width=".35"/>
    ${circ(31,20.5)}${circ(31,64.5)}
    <circle cx="80" cy="20.5" r="1" fill="${L}"/><circle cx="80" cy="64.5" r="1" fill="${L}"/>
    <rect x="74.5" y="0" width="1" height="85" fill="${B}" opacity=".9"/>
    <rect x="99.5" y="0" width="1" height="85" fill="#464A50" opacity=".85"/>
    <circle cx="100" cy="42.5" r="15" fill="none" stroke="${L}" stroke-width=".28"/><circle cx="100" cy="42.5" r=".6" fill="${L}"/>
    <rect x="0" y="0" width="128" height="85" fill="url(#il${id})"/>
    <path d="${boards}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2.4" transform="translate(0 .4)"/>
  </g>
  <path d="${boards}" fill="none" stroke="#D3D6DA" stroke-opacity=".75" stroke-width=".35"/>
  <path d="${boards}" fill="none" stroke="#F4F5F6" stroke-opacity=".10" stroke-width="1.1" transform="translate(0 -.9)"/>
  </g></svg>`;
}
/* Photoreal jersey: Blender-rendered base (jersey-src/) + tackle-twill lettering composited in SVG,
   displaced by the jersey's height field and multiplied by the fold shading. */
const JW=440,JH=395, CX=x=>0.349206*x+10.476, CY=y=>0.349206*y+9.773;
const TWILL={home:{num:'#F1EFEA',edge:'#B5121B',name:'#F1EFEA',stitch:'rgba(0,0,0,.28)'},
             away:{num:'#B5121B',edge:'#141416',name:'#141416',stitch:'rgba(0,0,0,.35)'}};
function twillFilter(id){
  return `<filter id="tw${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${JW}" height="${JH}" color-interpolation-filters="sRGB">
   <feImage href="${A}jersey-disp.png" x="0" y="0" width="${JW}" height="${JH}" preserveAspectRatio="none" result="dm"/>
   <feDisplacementMap in="SourceGraphic" in2="dm" scale="14" xChannelSelector="R" yChannelSelector="G" result="d"/>
   <feGaussianBlur in="d" stdDeviation="1.3" result="b"/>
   <feDiffuseLighting in="b" surfaceScale="2.4" diffuseConstant="1.18" lighting-color="#fff" result="diff"><feDistantLight azimuth="225" elevation="58"/></feDiffuseLighting>
   <feSpecularLighting in="b" surfaceScale="2.4" specularConstant=".5" specularExponent="16" lighting-color="#fff" result="spec"><feDistantLight azimuth="225" elevation="50"/></feSpecularLighting>
   <feBlend in="d" in2="diff" mode="multiply" result="lit"/>
   <feImage href="${A}jersey-shade.png" x="0" y="0" width="${JW}" height="${JH}" preserveAspectRatio="none" result="sh"/>
   <feBlend in="lit" in2="sh" mode="multiply" result="fold"/>
   <feComposite in="fold" in2="d" operator="in" result="foldIn"/>
   <feComposite in="spec" in2="d" operator="in" result="specIn"/>
   <feComposite in="specIn" in2="foldIn" operator="arithmetic" k2=".28" k3="1" result="twill"/>
   <feGaussianBlur in="d" stdDeviation="1.4" result="sb"/><feOffset in="sb" dx=".9" dy="1.6" result="so"/>
   <feFlood flood-color="#000" flood-opacity=".6"/><feComposite in2="so" operator="in" result="shadow"/>
   <feMerge><feMergeNode in="shadow"/><feMergeNode in="twill"/></feMerge></filter>`;
}
function twillText(txt,x,y,size,c,extra){
  const t=paint=>`<text x="${x}" y="${y}" text-anchor="middle" font-family="Big Shoulders Display,Barlow Condensed,sans-serif" font-weight="900" font-size="${size}" ${extra||''} ${paint}>${txt}</text>`;
  return t(`fill="${c.edge}" stroke="${c.edge}" stroke-width="${size*.075}" stroke-linejoin="round"`)+t(`fill="${c.num}"`)+
         (size>40?t(`fill="none" stroke="${c.stitch}" stroke-width="${size*.012}" stroke-dasharray="${size*.02} ${size*.016}"`):'');
}
function jersey(p,w,kitName,bare){
  const kit=kitName==='away'?'away':'home', C=TWILL[kit], h=Math.round(w*JH/JW), id='j'+(++uid);
  let letters='';
  if(!bare){
    const raw=String(p.name||'').toUpperCase(), nm=esc(raw), n=raw.length, fs=Math.min(30,160/(0.5*Math.max(n,1)));
    letters+=`<path id="na${id}" d="M60 ${CY(304)} Q220 ${CY(276)} 380 ${CY(304)}" fill="none"/>`+
      `<text font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="${fs.toFixed(1)}" letter-spacing="${(fs*.06).toFixed(2)}" fill="${C.name}"><textPath href="#na${id}" startOffset="50%" text-anchor="middle">${nm}</textPath></text>`;
    const no=String(p.no??'').replace(/[^0-9]/g,'').slice(0,2);
    if(no){
      letters+=twillText(no,CX(600),CY(628),138,C,'letter-spacing="3"');
      letters+=twillText(no,CX(242),CY(452),40,C,`transform="rotate(21 ${CX(242)} ${CY(438)})"`);
      letters+=twillText(no,CX(958),CY(452),40,C,`transform="rotate(-21 ${CX(958)} ${CY(438)})"`);
    }
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${JW} ${JH}" aria-hidden="true" focusable="false">${bare?'':`<defs>${twillFilter(id)}</defs>`}
   <image href="${A}jersey-${kit}.webp" width="${JW}" height="${JH}"/>
   ${bare?'':`<g filter="url(#tw${id})">${letters}</g>`}</svg>`;
}
/* scale the fixed-size rink down to its container (never up) */
function fit(el){
  const host=el.parentElement; if(!host||!el.dataset.w) return;
  const W=+el.dataset.w,H=+el.dataset.h,avail=host.clientWidth||W,s=Math.min(1,avail/W);
  el.style.transform=s<1?`scale(${s.toFixed(4)})`:'';el.style.transformOrigin='0 0';
  host.style.height=(H*s)+'px';
}
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>document.querySelectorAll('.wr-rk[data-w]').forEach(fit),120)});
function render(el,o){
  o=Object.assign({scale:6,jersey:84,players:[],labels:true,small:false,kit:'home'},o||{});
  const W=Math.round(134*o.scale),H=Math.round(91*o.scale), kit=o.kit==='away'?'away':'home';
  el.classList.add('wr-rk'); el.classList.toggle('sm',!!o.small);
  el.dataset.w=W; el.dataset.h=H; el.style.width=W+'px'; el.style.height=H+'px';
  const ps=o.players.filter(p=>XY[p.pos]);
  el.innerHTML=rinkSVG(++uid)+ps.map(p=>{const [x,y]=XY[p.pos];
     return `<div class="wr-jy${p.me?' me':''}" style="left:${(x+3)*o.scale}px;top:${(y+3)*o.scale}px">${jersey(p,o.jersey,kit)}${o.labels?`<span class="tg">${esc(p.pos)}${p.me?'<em>YOU</em>':p.tag?`<em>${esc(p.tag)}</em>`:''}</span>`:''}</div>`}).join('')
   +`<span class="wr-sr">Tonight's six (${kit} kit): ${esc(ps.map(p=>p.pos+' '+p.name+(p.no?' #'+p.no:'')).join(', '))}</span>`;
  fit(el);
}
function tabs(host,rinkEl,o){
  const G=o.games||[]; if(!G.length){host.innerHTML='';return}
  const draw=a=>{
    if(!G.some(g=>g.gm===a)) a=G[0].gm;
    host.className='wr-gmtabs'+(o.size?' '+o.size:'');host.setAttribute('role','tablist');
    host.innerHTML=G.map(g=>`<button type="button" role="tab" aria-selected="${g.gm===a}" class="gmt${g.gm===a?' on':''}" data-gm="${g.gm}"><span class="kit">${jersey({},o.size==='xs'?14:18,g.kit,true)}</span><span class="tx"><b>GM ${g.gm}</b><span>${g.home?'vs':'@'} ${esc(g.abbr)} · ${esc(g.time)}</span></span><em>${g.home?'Home':'Away'}</em></button>`).join('');
    const g=G.find(x=>x.gm===a);
    if(rinkEl){const ps=o.playersFor?o.playersFor(g):[];
      if(ps&&ps.length) render(rinkEl,Object.assign({},o.rink,{kit:g.kit,players:ps}));
      else if(o.empty) o.empty(rinkEl,g);}
    if(o.onChange) o.onChange(g);
    host.querySelectorAll('.gmt').forEach(btn=>btn.onclick=()=>draw(+btn.dataset.gm));
  };
  draw(o.active||G[0].gm);
}
window.WRRink={render,tabs,jersey,fit,XY};
})();
