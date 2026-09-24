export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  try{
    const base="https://chelstats.app";
    const html=await (await fetch(base+"/",{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}})).text();
    const srcs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>new URL(m[1],base).href).filter(u=>u.startsWith(base));
    const routes=new Set(), matchIdSnippets=[], gameSnippets=[];
    for(const url of [...new Set(srcs)].slice(0,12)){
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"*/*"}});
      if(!r.ok) continue;
      const js=await r.text();
      for(const m of js.matchAll(/\/api\/[A-Za-z0-9_./\$\{\}?&=:+%-]{2,160}/g)) routes.add(m[0]);
      for(const needle of ["matchId","period-stats","clubs/stats","games?","/games","gameType"]){
        let i=0,n=0;
        while((i=js.indexOf(needle,i))!==-1 && n<25){
          const s=js.slice(Math.max(0,i-350),Math.min(js.length,i+500));
          (needle==="matchId"?matchIdSnippets:gameSnippets).push({needle,snippet:s});
          i+=needle.length;n++;
        }
      }
    }
    const uniq=(arr,limit=80)=>{
      const out=[],seen=new Set();
      for(const x of arr){
        const key=x.snippet.replace(/\s+/g," ");
        if(seen.has(key)) continue;
        seen.add(key);out.push(x);
        if(out.length>=limit) break;
      }
      return out;
    };
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({
      scripts:[...new Set(srcs)],
      routes:[...routes].sort(),
      matchIdSnippets:uniq(matchIdSnippets,40),
      gameSnippets:uniq(gameSnippets,60)
    });
  }catch(e){
    return res.status(500).json({error:e?.message||"failed"});
  }
}
