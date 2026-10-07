(() => {
  const zones=[
    {id:1,name:'Behind Net (Center)',points:[[30,0],[60,0],[60,12],[30,12]]},
    {id:2,name:'Behind Net (Left)',points:[[6,12],[30,12],[30,0],[20,0],[12,4]]},
    {id:3,name:'Behind Net (Right)',points:[[60,0],[70,0],[78,4],[84,12],[60,12]]},
    {id:4,name:'Goal Crease',points:[[38,12],[52,12],[52,17],[49,20],[41,20],[38,17]]},
    {id:5,name:'Right Circle',points:[[75,12],[84,12],[90,30],[90,61],[64,27]]},
    {id:6,name:'Close Slot (Left)',points:[[15,12],[38,12],[38,17],[27,27]]},
    {id:7,name:'Close Slot (Center)',points:[[38,17],[41,20],[49,20],[52,17],[64,27],[54,32],[36,32],[27,27]]},
    {id:8,name:'Close Slot (Right)',points:[[52,12],[75,12],[64,27],[52,17]]},
    {id:9,name:'Left Circle',points:[[6,12],[15,12],[27,27],[0,61],[0,30]]},
    {id:10,name:'Mid Slot (Center)',points:[[36,32],[54,32],[60,56],[45,60],[30,56]]},
    {id:11,name:'Mid Slot (Left)',points:[[27,27],[36,32],[30,56],[11,47]]},
    {id:12,name:'Mid Slot (Right)',points:[[54,32],[64,27],[79,47],[60,56]]},
    {id:13,name:'Right Point',points:[[79,47],[90,61],[90,78],[66,78],[60,56]]},
    {id:14,name:'High Slot',points:[[30,56],[45,60],[60,56],[66,78],[24,78]]},
    {id:15,name:'Left Point',points:[[0,61],[11,47],[30,56],[24,78],[0,78]]},
    {id:16,name:'High Point',points:[[0,78],[90,78],[90,92],[0,92]]}
  ];

  const byId=Object.fromEntries(zones.map(z=>[z.id,z]));
  function pointInPolygon(x,y,points){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const xi=points[i][0],yi=points[i][1],xj=points[j][0],yj=points[j][1];
      const intersects=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);
      if(intersects)inside=!inside;
    }
    return inside;
  }
  function classifyNormalizedPoint(x,y){
    x=Number(x);y=Number(y);
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    const hit=zones.find(z=>pointInPolygon(x,y,z.points));
    return hit?{id:hit.id,name:hit.name}:null;
  }
  function normalizeXY(x,y,bounds={}){
    const xMin=Number(bounds.xMin??0),xMax=Number(bounds.xMax??90);
    const yMin=Number(bounds.yMin??0),yMax=Number(bounds.yMax??92);
    let nx=(Number(x)-xMin)/((xMax-xMin)||1)*90;
    let ny=(Number(y)-yMin)/((yMax-yMin)||1)*92;
    if(bounds.flipX)nx=90-nx;
    if(bounds.flipY)ny=92-ny;
    return {x:Math.max(0,Math.min(90,nx)),y:Math.max(0,Math.min(92,ny))};
  }
  function classifyXY(x,y,bounds){const p=normalizeXY(x,y,bounds);return {...p,zone:classifyNormalizedPoint(p.x,p.y)}}
  function sumRows(rows=[]){
    const out=zones.map(z=>({id:z.id,name:z.name,shots:0,goals:0}));
    for(const r of rows){
      const z=out.find(x=>x.id===Number(r.id));if(!z)continue;
      z.shots+=Number(r.shots||0);z.goals+=Number(r.goals||0);
    }
    const totalShots=out.reduce((n,z)=>n+z.shots,0),totalGoals=out.reduce((n,z)=>n+z.goals,0);
    out.forEach(z=>{z.shotShare=totalShots?100*z.shots/totalShots:0;z.goalShare=totalGoals?100*z.goals/totalGoals:0;z.efficiency=z.shots?100*z.goals/z.shots:0});
    return {zones:out,totalShots,totalGoals};
  }
  function polygonPoints(points){return points.map(p=>p.join(',')).join(' ')}
  function heatOpacity(value,max){return max>0?Math.max(.08,Math.min(.92,.1+.82*(value/max))):.05}
  function renderSvg(rows=[],options={}){
    const metric=options.metric==='goals'?'goals':options.metric==='efficiency'?'efficiency':'shots';
    const data=sumRows(rows),max=Math.max(1,...data.zones.map(z=>Number(z[metric]||0)));
    const fill=options.fill||'#d7192d';
    const paths=data.zones.map(z=>{
      const meta=byId[z.id],value=Number(z[metric]||0),op=heatOpacity(value,max);
      const label=`${meta.name}: ${z.shots} shots, ${z.goals} goals, ${z.efficiency.toFixed(1)}% conversion, ${z.shotShare.toFixed(1)}% shot share`;
      return `<g class="wm-zone" data-zone="${z.id}"><polygon points="${polygonPoints(meta.points)}" fill="${fill}" fill-opacity="${op.toFixed(3)}" stroke="rgba(255,255,255,.18)" stroke-width=".6"><title>${label}</title></polygon><text x="${meta.points.reduce((n,p)=>n+p[0],0)/meta.points.length}" y="${meta.points.reduce((n,p)=>n+p[1],0)/meta.points.length}" text-anchor="middle" dominant-baseline="middle" font-size="3.3" font-weight="800" fill="white" opacity=".92">${value?Math.round(value):''}</text></g>`;
    }).join('');
    return `<svg class="wm-ice-zone-svg" viewBox="0 0 90 92" role="img" aria-label="EA 16-zone shooting heat map"><rect x="0" y="0" width="90" height="92" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.18)" stroke-width=".7"/><line x1="0" y1="12" x2="90" y2="12" stroke="rgba(80,150,255,.45)" stroke-width=".8"/><line x1="0" y1="78" x2="90" y2="78" stroke="rgba(80,150,255,.3)" stroke-width=".8"/><path d="M38 12 Q38 20 45 20 Q52 20 52 12" fill="none" stroke="rgba(80,150,255,.55)" stroke-width=".7"/>${paths}</svg>`;
  }

  /* Chelstats-style "Shot Location Analysis": Shots/Goals x Totals/Per game/Efficiency %/Total % over an ice map + net map.
     opts: {ice:[{id,shots,goals}], net:[{id,shots,goals}]|null (ids 1-5: TL,TR,BL,BR,five-hole), gp:number|null, state:{base,mode}} */
  const SLA_MODES=[['totals','Totals'],['pergame','Per game'],['efficiency','Efficiency %'],['share','Total %']];
  function slaValue(rows,base,mode,gp){
    const tot=rows.reduce((n,r)=>n+Number(r[base]||0),0);
    return rows.map(r=>{
      const v=Number(r[base]||0),sh=Number(r.shots||0),gl=Number(r.goals||0);
      if(mode==='pergame')return gp?v/gp:null;
      if(mode==='efficiency')return sh?100*gl/sh:0;
      if(mode==='share')return tot?100*v/tot:0;
      return v;
    });
  }
  function slaFmt(v,mode){
    if(v==null)return '–';
    if(mode==='pergame')return v.toFixed(2);
    if(mode==='efficiency'||mode==='share')return v.toFixed(1)+'%';
    return String(Math.round(v));
  }
  function slaShade(v,max){const t=max>0&&v>0?Math.min(1,v/max):0;return `rgba(${Math.round(40+50*t)},${Math.round(90+90*t)},${Math.round(160+90*t)},${(.28+.67*t).toFixed(3)})`}
  function slaHtml(opts){
    const st=opts.state||{base:'shots',mode:'totals'},gp=Number(opts.gp)||null;
    const modes=SLA_MODES.filter(m=>m[0]!=='pergame'||gp);
    if(!modes.some(m=>m[0]===st.mode))st.mode='totals';
    const ice=Array.from({length:16},(_,i)=>{const r=(opts.ice||[]).find(x=>Number(x.id)===i+1)||{};return {id:i+1,shots:Number(r.shots||0),goals:Number(r.goals||0)}});
    const iv=slaValue(ice,st.base,st.mode,gp),im=Math.max(0,...iv.map(v=>v||0));
    const polys=ice.map((z,i)=>{const meta=byId[z.id],cx=meta.points.reduce((n,p)=>n+p[0],0)/meta.points.length,cy=meta.points.reduce((n,p)=>n+p[1],0)/meta.points.length;
      return `<g><polygon points="${polygonPoints(meta.points)}" fill="${slaShade(iv[i]||0,im)}" stroke="rgba(255,255,255,.35)" stroke-width=".5"><title>${meta.name}: ${z.shots} shots, ${z.goals} goals${z.shots?' ('+(100*z.goals/z.shots).toFixed(1)+'%)':''}</title></polygon><text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="3.6" font-weight="800" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width=".5" paint-order="stroke">${slaFmt(iv[i],st.mode)}</text></g>`}).join('');
    const iceSvg=`<svg class="sla-ice" viewBox="0 0 90 92" role="img" aria-label="Ice zone shot location map"><defs><clipPath id="slaClip"><path d="M0 92V16Q0 0 16 0H74Q90 0 90 16V92Z"/></clipPath></defs><g clip-path="url(#slaClip)"><rect width="90" height="92" fill="#0d1624"/>${polys}<line x1="0" y1="12" x2="90" y2="12" stroke="rgba(255,90,90,.7)" stroke-width=".6"/><path d="M38 12Q38 20 45 20Q52 20 52 12" fill="rgba(80,150,255,.25)" stroke="rgba(160,200,255,.8)" stroke-width=".5"/></g></svg>`;
    let netSvg='';
    if(opts.net&&opts.net.some(r=>Number(r.shots)||Number(r.goals))){
      const net=[1,2,3,4,5].map(i=>{const r=opts.net.find(x=>Number(x.id)===i)||{};return {id:i,shots:Number(r.shots||0),goals:Number(r.goals||0)}});
      const nv=slaValue(net,st.base,st.mode,gp),nm=Math.max(0,...nv.map(v=>v||0));
      const box=[[6,6,44,28],[50,6,44,28],[6,34,44,28],[50,34,44,28]];
      const cells=box.map((b,i)=>`<g><rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" fill="${slaShade(nv[i]||0,nm)}" stroke="rgba(255,255,255,.3)" stroke-width=".5"><title>Net zone ${i+1}: ${net[i].shots} shots, ${net[i].goals} goals</title></rect><text x="${b[0]+b[2]/2}" y="${b[1]+b[3]/2}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="800" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width=".7" paint-order="stroke">${slaFmt(nv[i],st.mode)}</text></g>`).join('');
      netSvg=`<div class="sla-net-wrap"><span class="sla-cap">Net zones</span><svg class="sla-net" viewBox="0 0 100 68" role="img" aria-label="Net zone shot location map"><rect x="2" y="2" width="96" height="62" fill="#0d1624" stroke="#c62a2f" stroke-width="3"/>${cells}<g><circle cx="50" cy="58" r="8" fill="${slaShade(nv[4]||0,nm)}" stroke="rgba(255,255,255,.4)" stroke-width=".5"><title>Five-hole: ${net[4].shots} shots, ${net[4].goals} goals</title></circle><text x="50" y="58" text-anchor="middle" dominant-baseline="middle" font-size="6" font-weight="800" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width=".6" paint-order="stroke">${slaFmt(nv[4],st.mode)}</text></g></svg></div>`;
    }
    const tab=(attr,val,label,on)=>`<button type="button" data-sla-${attr}="${val}" aria-pressed="${on}">${label}</button>`;
    return `<div class="sla"><div class="sla-tabs"><div role="group" aria-label="Shots or goals">${tab('base','shots','Shots',st.base==='shots')}${tab('base','goals','Goals',st.base==='goals')}</div><div role="group" aria-label="Display mode">${modes.map(m=>tab('mode',m[0],m[1],st.mode===m[0])).join('')}</div></div><div class="sla-maps"><div class="sla-ice-wrap"><span class="sla-cap">Ice zones</span>${iceSvg}</div>${netSvg}</div><div class="sla-legend"><span>Low</span><i></i><span>High</span>${gp?`<em>${gp} GP</em>`:''}</div></div>`;
  }
  function mountAnalysis(el,opts){
    if(!el)return;
    opts.state=opts.state||{base:'shots',mode:'totals'};
    const draw=()=>{el.innerHTML=slaHtml(opts);
      el.querySelectorAll('[data-sla-base]').forEach(b=>b.onclick=()=>{opts.state.base=b.dataset.slaBase;draw()});
      el.querySelectorAll('[data-sla-mode]').forEach(b=>b.onclick=()=>{opts.state.mode=b.dataset.slaMode;draw()})};
    draw();
  }
  window.WildmanShotZones={zones,byId,classifyNormalizedPoint,normalizeXY,classifyXY,sumRows,renderSvg,renderAnalysis:slaHtml,mountAnalysis};
})();