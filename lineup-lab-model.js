/* Lineup Lab model: "Sandbox Chemistry v0" + "Simulate Tonight" matchup v0. PLACEHOLDERS.
   Our own implementation of the formulas in war-room-plan CHEMISTRY.md §4 (chemistry) and §6.3
   (matchup). Pure functions, no I/O, no team constants: the caller passes rows it was allowed to SELECT.
   Replace with the tendencies-and-ratings model when it exists.                                   */
(function(root){
'use strict';
const SK=['LW','C','RW','LD','RD'], POS=['LW','C','RW','LD','RD','G'];
const fin=v=>{const n=+v;return Number.isFinite(n)?n:0};
const has=v=>v!=null&&v!==''&&Number.isFinite(+v);
const clamp=(v,lo=0,hi=100)=>Math.min(hi,Math.max(lo,fin(v)));
const unit=v=>clamp(v,-1,1);
const isD=p=>p==='LD'||p==='RD';
const lc=s=>String(s||'').trim().toLowerCase();
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const median=a=>{if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1))};

/* ---------- labels ---------- */
const confidence=g=>g>=10?'High':g>=4?'Medium':g>=1?'Low':'Projected';
const chemLabel=s=>s>=75?'Elite':s>=60?'Strong':s>=40?'Average':s>=25?'Weak':'Poor';

/* ---------- §5.1 deduped player-game base ---------- */
/* reports: team_player_game_reports rows {schedule_game_id,locker_id,position_played,stats,ea_match_id,created_at}
   schedule: hitmen_schedule_games rows. Only finals with a score count; W/L comes from the schedule, never `result`. */
function finals(schedule){
  const m=new Map();
  (schedule||[]).forEach(r=>{if(r.status==='final'&&has(r.calgary_score)&&has(r.opponent_score))
    m.set(r.id,{id:r.id,gf:+r.calgary_score,ga:+r.opponent_score,win:+r.calgary_score>+r.opponent_score,ot:!!r.overtime,opp:r.opponent_name,at:r.scheduled_at})});
  return m;
}
function baseRows(reports,games){
  const pick=new Map();
  (reports||[]).forEach(r=>{
    const s=r.stats||{}; if(!Object.prototype.hasOwnProperty.call(s,'toi')) return;   // review shells carry no box score
    if(!games.has(r.schedule_game_id)||!r.locker_id) return;
    const k=r.schedule_game_id+'|'+r.locker_id, cur=pick.get(k);
    const better=!cur||(!!r.ea_match_id>!!cur.ea_match_id)||((!!r.ea_match_id===!!cur.ea_match_id)&&String(r.created_at)<String(cur.created_at));
    if(better) pick.set(k,r);
  });
  return [...pick.values()].map(r=>{const s=r.stats||{},n=k=>fin(s[k]);
    return {gid:r.schedule_game_id,lid:r.locker_id,pos:String(r.position_played||'').toUpperCase(),
      pts:has(s.points)?n('points'):n('goals')+n('assists'),g:n('goals'),a:n('assists'),s:n('shots'),hits:n('hits'),
      tk:n('takeaways'),int:n('interceptions'),bs:n('blocked_shots'),gv:n('giveaways'),dp:n('takeaways')+n('interceptions')+n('blocked_shots'),
      fow:has(s.faceoff_wins)?n('faceoff_wins'):null,fol:has(s.faceoff_losses)?n('faceoff_losses'):null,
      saves:n('saves'),sf:n('shots_faced'),gaG:n('goals_against')}});
}

/* ---------- LG season rows -> lines ---------- */
/* lg rows: {gamertag,position,games_played,season,g,a,s,h,tk,gv,int,bs,fop,passp,gf,ga,rec,svp,gaa,sog,gag} */
const recW=rec=>{const m=String(rec||'').match(/^(\d+)-(\d+)(?:-(\d+))?/);return m?{w:+m[1],l:+m[2],o:+(m[3]||0)}:null};
function lgLine(rows){
  const t={gp:0,w:0,gf:0,ga:0,pts:0,dp:0,hits:0,g:0,a:0,s:0,gv:0,tk:0,int:0,rec:0};
  rows.forEach(r=>{const gp=fin(r.games_played);if(!gp)return;const w=recW(r.rec);
    t.gp+=gp;t.g+=fin(r.g);t.a+=fin(r.a);t.pts+=fin(r.g)+fin(r.a);t.s+=fin(r.s);t.hits+=fin(r.h);t.gv+=fin(r.gv);t.tk+=fin(r.tk);t.int+=fin(r.ic);
    t.dp+=fin(r.tk)+fin(r.ic)+fin(r.bs);t.gf+=fin(r.gf);t.ga+=fin(r.ga);if(w){t.w+=w.w;t.rec+=w.w+w.l+w.o}});
  return t;
}
function addLine(a,b){const o={};Object.keys(a).forEach(k=>o[k]=a[k]+(b[k]||0));return o}
function baseLine(rows,games){
  const t={gp:0,w:0,gf:0,ga:0,pts:0,dp:0,hits:0,g:0,a:0,s:0,gv:0,tk:0,int:0,rec:0};
  rows.forEach(r=>{const gm=games.get(r.gid);if(!gm)return;t.gp++;t.rec++;t.w+=gm.win?1:0;t.gf+=gm.gf;t.ga+=gm.ga;
    t.pts+=r.pts;t.dp+=r.dp;t.hits+=r.hits;t.g+=r.g;t.a+=r.a;t.s+=r.s;t.gv+=r.gv;t.tk+=r.tk;t.int+=r.int});
  return t;
}
function rates(t){if(!t||!t.gp)return null;const gp=t.gp;
  return {gp,winPct:t.rec?100*t.w/t.rec:50,gdPerGame:t.rec?(t.gf-t.ga)/t.gp:0,ppg:t.pts/gp,dpg:t.dp/gp,hpg:t.hits/gp,gpg:t.g/gp,apg:t.a/gp,gaPg:t.rec?t.ga/gp:null}}

/* ---------- league baselines (LGCHL current season, by position) ---------- */
function baselines(lgRows){
  const B={};
  POS.forEach(p=>{
    const R=(lgRows||[]).filter(r=>String(r.position).toUpperCase()===p&&fin(r.games_played)>0);
    const GP=R.reduce((s,r)=>s+fin(r.games_played),0)||1;
    const tot=k=>R.reduce((s,r)=>s+fin(r[k]),0)/GP;
    const per=(f,min=3)=>R.filter(r=>fin(r.games_played)>=min).map(f).filter(Number.isFinite);
    const stat=(m,arr,floor)=>({m,sd:Math.max(sd(arr),floor)});
    const gp=r=>fin(r.games_played);
    if(p==='G'){
      const sv=R.filter(r=>has(r.svp)).map(r=>+r.svp>1?+r.svp/100:+r.svp);
      B.G={n:R.length,sv:stat(mean(sv),sv,.02),gaa:mean(R.filter(r=>has(r.gaa)).map(r=>+r.gaa))};return;
    }
    const fo=R.filter(r=>has(r.fop)).map(r=>+r.fop);
    const pass=R.filter(r=>has(r.passp)).map(r=>+r.passp);
    const shp=R.filter(r=>fin(r.s)>0).map(r=>fin(r.g)/fin(r.s));
    B[p]={n:R.length,
      gpg:stat(tot('g'),per(r=>fin(r.g)/gp(r)),.05),apg:stat(tot('a'),per(r=>fin(r.a)/gp(r)),.05),spg:stat(tot('s'),per(r=>fin(r.s)/gp(r)),.2),
      att:stat(tot('g')+.5*tot('a'),per(r=>(fin(r.g)+.5*fin(r.a))/gp(r)),.05),
      hpg:stat(tot('h'),per(r=>fin(r.h)/gp(r)),.2),
      dpg:stat(tot('tk')+tot('ic')+tot('bs'),per(r=>(fin(r.tk)+fin(r.ic)+fin(r.bs))/gp(r)),.2),
      dnet:stat(tot('tk')+tot('ic')+tot('bs')-.5*tot('gv'),per(r=>(fin(r.tk)+fin(r.ic)+fin(r.bs)-.5*fin(r.gv))/gp(r)),.2),
      tkint:stat(tot('tk')+tot('ic'),per(r=>(fin(r.tk)+fin(r.ic))/gp(r)),.2),
      shp:stat(R.reduce((s,r)=>s+fin(r.g),0)/Math.max(1,R.reduce((s,r)=>s+fin(r.s),0)),shp,.03),
      pass:stat(mean(pass),pass,2),fo:stat(fo.length?mean(fo):50,fo,3)};
  });
  return B;
}
/* style refs for the lean: forwards goals vs assists, defence hits vs def plays */
const styleRefs=B=>({off:{mx:mean(['LW','C','RW'].map(p=>B[p]?.gpg.m||0)),sx:mean(['LW','C','RW'].map(p=>B[p]?.gpg.sd||1)),my:mean(['LW','C','RW'].map(p=>B[p]?.apg.m||0)),sy:mean(['LW','C','RW'].map(p=>B[p]?.apg.sd||1))},
  def:{mx:mean(['LD','RD'].map(p=>B[p]?.hpg.m||0)),sx:mean(['LD','RD'].map(p=>B[p]?.hpg.sd||1)),my:mean(['LD','RD'].map(p=>B[p]?.dpg.m||0)),sy:mean(['LD','RD'].map(p=>B[p]?.dpg.sd||1))}});

/* ---------- §4.1 pair score ---------- */
const gdScore=gd=>clamp(50+12.5*fin(gd));
const prodOff=(pts,dp)=>clamp(clamp(pts/4.5*100)+.15*clamp(dp/12*100));
const prodDef=(dp,ga,pts)=>{const a=clamp(dp/12*100),b=ga==null?a:(a+clamp(100-ga/6*100))/2;return clamp(b+.15*clamp(pts/4.5*100))};
const modeOf=(a,b)=>isD(a)&&isD(b)?'defense':(!isD(a)&&!isD(b))?'offense':'bridge';
const prodFor=(mode,x)=>mode==='offense'?prodOff(x.pts,x.dp):mode==='defense'?prodDef(x.dp,x.ga,x.pts):(prodOff(x.pts,x.dp)+prodDef(x.dp,x.ga,x.pts))/2;
const mix=c=>(30*c.win+20*c.gd+30*c.prod+20*c.style)/100;
function lean(x,y,ref,min){const s=x+y;if(s<min)return 0;const raw=(x-y)/s*2;if(!ref)return raw;return .5*raw+.5*((x-ref.mx)/(ref.sx||1)-(y-ref.my)/(ref.sy||1))}
function leanOf(line,mode,refs){if(!line)return null;return mode==='defense'?lean(line.hpg,line.dpg,refs?.def,1):lean(line.gpg,line.apg,refs?.off,.2)}
function styleTag(l,slot){if(l==null)return '';if(isD(slot))return l>.35?'physical':l<-.35?'takeaway D':'two-way';return l>.35?'shooter':l<-.35?'playmaker':'balanced'}

/* ctx = createContext(...) below */
function pairScore(ctx,A,B,sa,sb){
  const mode=modeOf(sa,sb);
  const pa=ctx.prior(A,sa,B),pb=ctx.prior(B,sb,A);
  const la=leanOf(pa&&pa.line,mode,ctx.refs),lb=leanOf(pb&&pb.line,mode,ctx.refs);
  const style=la==null||lb==null?50:clamp(Math.min(Math.abs(la-lb),2.5)/2.5*100);
  let prior=50,priorNote='no out-of-sample data · neutral 50';
  if(pa&&pb){
    const x={pts:pa.line.ppg+pb.line.ppg,dp:pa.line.dpg+pb.line.dpg,ga:pa.line.gaPg!=null&&pb.line.gaPg!=null?(pa.line.gaPg+pb.line.gaPg)/2:null};
    prior=mix({win:(pa.line.winPct+pb.line.winPct)/2,gd:gdScore((pa.line.gdPerGame+pb.line.gdPerGame)/2),prod:prodFor(mode,x),style});
    const off=pa.off||pb.off;priorNote=`${[...new Set([pa.src,pb.src].join(" + ").split(" + "))].join(" + ")} projection${off?' · off-position −10':''}`;
    if(off) prior-=10;
  }
  prior=clamp(prior);
  const sh=ctx.shared(A,B,sa,sb), G=sh.G;
  const out={a:A,b:B,sa,sb,mode,G,style:Math.round(style),prior:Math.round(prior),priorNote,tags:[styleTag(la,sa),styleTag(lb,sb)],confidence:confidence(G)};
  if(!G) return Object.assign(out,{score:Math.round(prior),source:'projected'});
  const actual=clamp(mix({win:100*sh.W/G,gd:gdScore(sh.gd/G),prod:prodFor(mode,{pts:sh.pts/G,dp:sh.dp/G,ga:sh.ga/G}),style}));
  const n=G/(G+3);
  return Object.assign(out,{score:Math.round(clamp(prior+(actual-prior)*n)),source:'actual',actual:Math.round(actual),shrink:+n.toFixed(2),
    W:sh.W,L:G-sh.W,gdPg:sh.gd/G,ptsPg:sh.pts/G,dpPg:sh.dp/G});
}

/* ---------- §4.2 the six ---------- */
const F_LINKS=[['LW','C'],['C','RW'],['LW','RW']];
const BRIDGES=[['LW','LD'],['LW','RD'],['C','LD'],['C','RD'],['RW','LD'],['RW','RD']];
function sixChemistry(ctx,six){
  const missing=SK.filter(p=>!six[p]);
  if(missing.length) return {complete:false,missing};
  const P=(a,b)=>pairScore(ctx,six[a],six[b],a,b);
  const f=F_LINKS.map(([a,b])=>P(a,b)),d=P('LD','RD'),br=BRIDGES.map(([a,b])=>P(a,b));
  const u=ctx.unit(six), n5=u.G/(u.G+3);
  const U=u.G?50+n5*(.6*(100*u.W/u.G)+.4*gdScore(u.gd/u.G)-50):50;
  const parts={forwards:mean(f.map(x=>x.score)),dPair:d.score,bridges:mean(br.map(x=>x.score)),unit:U};
  const score=clamp(.35*parts.forwards+.2*parts.dPair+.25*parts.bridges+.2*parts.unit);
  const links=[...f,d,...br], gMed=median(links.map(x=>x.G));
  return {complete:true,score:Math.round(score),label:chemLabel(score),confidence:confidence(Math.max(u.G,Math.round(gMed))),
    parts:{forwards:Math.round(parts.forwards),dPair:Math.round(parts.dPair),bridges:Math.round(parts.bridges),unit:Math.round(parts.unit)},
    unit:u,links:{forwards:f,dPair:d,bridges:br},medianG:gMed};
}

/* ---------- context: who played where, with whom, and out-of-sample priors ---------- */
/* opts: {schedule, reports, lockers, lgSeason (current LGCHL rows), lgCareer (prior-season LGCHL rows), shared:true|false}
   shared=false when the viewer can't see teammates' box scores (RLS): then chemistry is career-projection only. */
function createContext(o){
  const games=finals(o.schedule), base=o.shared?baseRows(o.reports,games):[];
  const B=baselines(o.lgSeason||[]), refs=styleRefs(B);
  const lockers=new Map((o.lockers||[]).map(l=>[l.id,l]));
  const byGame=new Map();base.forEach(r=>{if(!byGame.has(r.gid))byGame.set(r.gid,new Map());byGame.get(r.gid).set(r.lid,r)});
  const tagOf=id=>lc(lockers.get(id)?.gamertag);
  const career=new Map();(o.lgCareer||[]).forEach(r=>{const k=lc(r.gamertag);if(!career.has(k))career.set(k,[]);career.get(k).push(r)});
  const careerLine=(id,slot)=>{const rows=career.get(tagOf(id))||[];return lgLine(slot?rows.filter(r=>String(r.position).toUpperCase()===slot):rows)};
  const rowsOf=(id,pred)=>base.filter(r=>r.lid===id&&pred(r));
  const together=(a,b)=>new Set([...byGame].filter(([,m])=>m.has(a)&&m.has(b)).map(([g])=>g));
  const pc=new Map();
  function prior(id,slot,partner){
    const key=id+'|'+slot+'|'+partner; if(pc.has(key)) return pc.get(key);
    const tog=partner?together(id,partner):new Set();
    const apartAt=baseLine(rowsOf(id,r=>r.pos===slot&&!tog.has(r.gid)),games), carAt=careerLine(id,slot);
    let line=addLine(apartAt,carAt),off=false,src=[apartAt.gp?'S55 games apart':'',carAt.gp?'career':''].filter(Boolean).join(' + ');
    if(!line.gp){const apart=baseLine(rowsOf(id,r=>!tog.has(r.gid)),games),car=careerLine(id,null);line=addLine(apart,car);off=true;
      src=[apart.gp?'S55 games apart':'',car.gp?'career':''].filter(Boolean).join(' + ')}
    const res=line.gp?{line:rates(line),off,src:src||'career'}:null;pc.set(key,res);return res;
  }
  function shared(a,b,sa,sb){
    const t={G:0,W:0,gd:0,pts:0,dp:0,ga:0};
    byGame.forEach((m,gid)=>{const ra=m.get(a),rb=m.get(b);if(!ra||!rb||ra.pos!==sa||rb.pos!==sb)return;const gm=games.get(gid);
      t.G++;t.W+=gm.win?1:0;t.gd+=gm.gf-gm.ga;t.ga+=gm.ga;t.pts+=ra.pts+rb.pts;t.dp+=ra.dp+rb.dp});
    return t;
  }
  function unitRec(six){
    const t={G:0,W:0,gd:0};
    byGame.forEach((m,gid)=>{if(SK.every(p=>{const r=m.get(six[p]);return r&&r.pos===p})){const gm=games.get(gid);t.G++;t.W+=gm.win?1:0;t.gd+=gm.gf-gm.ga}});
    return t;
  }
  /* slot history for "position fit": S55 GP at the slot (shared box scores) and career GP at the slot */
  function slotGP(id,slot){return {s55:base.filter(r=>r.lid===id&&r.pos===slot).length,career:careerLine(id,slot).gp}}
  function playerBase(id){return baseLine(rowsOf(id,()=>true),games)}
  function faceoffs(id){let w=0,l=0,n=0;base.forEach(r=>{if(r.lid===id&&r.pos==='C'&&r.fow!=null&&r.fol!=null){w+=r.fow;l+=r.fol;n++}});return n?{w,l,games:n}:null}
  function goalieBase(id){let sf=0,sv=0,ga=0,gp=0;base.forEach(r=>{if(r.lid===id&&r.pos==='G'){sf+=r.sf;sv+=r.saves;ga+=r.gaG;gp++}});return gp?{gp,sf,sv,ga}:null}
  return {games,base,B,refs,prior,shared,unit:unitRec,slotGP,playerBase,faceoffs,goalieBase,shareMode:!!o.shared,gamesWithBox:byGame.size};
}

/* ---------- §6.3 matchup lanes ---------- */
const shr=(x,n,base,k)=>(fin(n)*fin(x)+k*fin(base))/(fin(n)+k);
const zz=(v,s)=>s?(v-s.m)/(s.sd||1):0;
/* player stat line for the matchup: {gp,g,a,s,h,tk,int,bs,gv,fop,draws,fow,fol,pass,svp,sog,gaa,src,name} */
function lanes(ctx,us,them,opt){
  opt=opt||{};const B=ctx.B, W={fo:.10,lwA:.125,rwA:.125,lwT:.125,rwT:.125,mid:.10,g:.20,chem:.10};
  const per=(p,k)=>p&&p.gp?fin(p[k])/p.gp:0, gp=p=>p?fin(p.gp):0;
  const L=[];
  // 1 faceoffs
  {const o=us.C,t=them.C,base=B.C?.fo.m??49.7;
   const of=o&&has(o.fop)?shr(o.fop,o.draws,base,60):base, tf=t&&has(t.fop)?shr(t.fop,t.draws,base,60):base;
   L.push({id:'fo',w:W.fo,e:unit((of-tf)/10),us:'C',them:'C',inputs:{our:{raw:o&&has(o.fop)?+o.fop:null,draws:o?.draws||0,shr:of,fw:o?.fow,fl:o?.fol,est:o?.drawsEst},their:{raw:t&&has(t.fop)?+t.fop:null,draws:t?.draws||0,shr:tf,est:t?.drawsEst},base}})}
  // 2/3 our wingers attack their D
  [['lwA','LW','RD'],['rwA','RW','LD']].forEach(([id,ws,ds])=>{const o=us[ws],t=them[ds],bw=B[ws],bd=B[ds];
    const att=shr(o?(fin(o.g)+.5*fin(o.a))/(gp(o)||1):0,gp(o),bw.att.m,5), sh=shr(per(o,'s'),gp(o),bw.spg.m,5);
    const dn=shr(t?(fin(t.tk)+fin(t.int)+fin(t.bs)-.5*fin(t.gv))/(gp(t)||1):0,gp(t),bd.dnet.m,5);
    const zA=(zz(att,bw.att)+zz(sh,bw.spg))/2, zD=zz(dn,bd.dnet);
    L.push({id,w:W[id],e:unit((zA-zD)/2),us:ws,them:ds,inputs:{our:{gp:gp(o),attRaw:o&&gp(o)?(fin(o.g)+.5*fin(o.a))/gp(o):null,att,sRaw:o&&gp(o)?per(o,'s'):null,s:sh,base:bw.att.m,sBase:bw.spg.m},
      their:{gp:gp(t),dnRaw:t&&gp(t)?(fin(t.tk)+fin(t.int)+fin(t.bs)-.5*fin(t.gv))/gp(t):null,dn,base:bd.dnet.m},zA,zD}})});
  // 4/5 their wingers threaten our D
  [['lwT','LW','RD'],['rwT','RW','LD']].forEach(([id,ws,ds])=>{const t=them[ws],o=us[ds],bw=B[ws],bd=B[ds];
    const g=shr(per(t,'g'),gp(t),bw.gpg.m,5), s=shr(per(t,'s'),gp(t),bw.spg.m,5), shp=shr(t&&fin(t.s)?fin(t.g)/fin(t.s):bw.shp.m,gp(t),bw.shp.m,5);
    const dp=shr(o?(fin(o.tk)+fin(o.int)+fin(o.bs))/(gp(o)||1):0,gp(o),bd.dpg.m,5), h=shr(per(o,'h'),gp(o),bd.hpg.m,5);
    const zA=(zz(g,bw.gpg)+zz(s,bw.spg)+zz(shp,bw.shp))/3, zD=(zz(dp,bd.dpg)+zz(h,bd.hpg))/2;
    const key=!!t&&(g>=1.5*bw.gpg.m||(opt.threatNames||[]).some(n=>t.names&&t.names.some(x=>x&&n.includes(x))));
    L.push({id,w:W[id],e:-unit((zA-zD)/2),us:ds,them:ws,key,inputs:{their:{gp:gp(t),gRaw:t&&gp(t)?per(t,'g'):null,g,sRaw:t&&gp(t)?per(t,'s'):null,s,shp,base:bw.gpg.m},
      our:{gp:gp(o),dpRaw:o&&gp(o)?(fin(o.tk)+fin(o.int)+fin(o.bs))/gp(o):null,dp,hRaw:o&&gp(o)?per(o,'h'):null,h,base:bd.dpg.m},zA,zD}})});
  // 6 middle
  {const t=them.C,o=us.C,b=B.C;
   const a=shr(per(t,'a'),gp(t),b.apg.m,5), ps=shr(t&&has(t.pass)?+t.pass:b.pass.m,gp(t),b.pass.m,5), ti=shr(o?(fin(o.tk)+fin(o.int))/(gp(o)||1):0,gp(o),b.tkint.m,5);
   const zP=(zz(a,b.apg)+zz(ps,b.pass))/2, zD=zz(ti,b.tkint);
   const key=!!t&&(opt.threatNames||[]).some(n=>t.names&&t.names.some(x=>x&&n.includes(x)));
   L.push({id:'mid',w:W.mid,e:-unit((zP-zD)/2),us:'C',them:'C',key,inputs:{their:{gp:gp(t),aRaw:t&&gp(t)?per(t,'a'):null,a,passRaw:t&&has(t.pass)?+t.pass:null,pass:ps},our:{gp:gp(o),tiRaw:o&&gp(o)?(fin(o.tk)+fin(o.int))/gp(o):null,ti},zP,zD}})}
  // 7 goalie duel
  {const bg=B.G?.sv.m??.796, og=us.G, tg=them.G;
   const osv=og&&has(og.svp)?shr(og.svp,og.sog,bg,100):bg, tsv=tg&&has(tg.svp)?shr(tg.svp,tg.sog,bg,100):bg;
   const shotsOf=(side,ps)=>SK.reduce((s,p)=>{const x=side[p],b=B[p];return s+shr(per(x,'s'),gp(x),b.spg.m,5)},0);
   const theirShots=shotsOf(them), ourShots=shotsOf(us), xUs=theirShots*(1-osv), xThem=ourShots*(1-tsv);
   L.push({id:'g',w:W.g,e:unit((xThem-xUs)/2),us:'G',them:'G',inputs:{our:{raw:og&&has(og.svp)?+og.svp:null,shots:og?.sog||0,sv:osv},their:{raw:tg&&has(tg.svp)?+tg.svp:null,shots:tg?.sog||0,sv:tsv},base:bg,theirShots,ourShots,xUs,xThem}})}
  // 8 chemistry
  {const c=opt.chem, low=!c||c.confidence==='Low'||c.confidence==='Projected';
   const e=c&&c.complete?((c.score-50)/50)*(low?.5:1):0;
   L.push({id:'chem',w:W.chem,e:unit(e),us:'six',them:'',inputs:{score:c?.score,label:c?.label,confidence:c?.confidence,halved:low}})}
  return L;
}
function verdict(L,opt){
  opt=opt||{};
  const T=L.reduce((s,l)=>s+l.w*l.e,0);
  const threat=L.filter(l=>l.key&&l.e<=-.6);
  const g=L.find(l=>l.id==='g');
  const goalieFlag=!!(opt.topThirdShots&&g&&g.inputs.our.sv<.760);
  const v=(T<=-.15||threat.length||goalieFlag)?'Risky':(T>=.15&&!threat.length)?'Strong':'Even';
  const reasons=L.map(l=>({l,c:l.w*l.e})).filter(x=>Math.abs(x.c)>0.0005).sort((a,b)=>Math.abs(b.c)-Math.abs(a.c)).slice(0,3);
  return {T,verdict:v,threat,goalieFlag,reasons};
}
function matchupConfidence(o){
  const gps=o.gps||[];const m=median(gps);
  if(o.warnings||!o.approved||!o.resolved) return {label:'Low',medianGP:m,why:o.warnings?'identity warnings':!o.approved?'draft report':'unresolved names'};
  return {label:m>=8?'High':m>=4?'Medium':'Low',medianGP:m,why:`median ${m} GP`};
}

const api={POS,SK,confidence,chemLabel,createContext,pairScore,sixChemistry,baselines,lanes,verdict,matchupConfidence,shr,finals,baseRows,lc,median};
if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.LabModel=api;
})(typeof window!=='undefined'?window:globalThis);
