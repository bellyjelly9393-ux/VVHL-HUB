export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  try{
    const base="https://chelstats.app";
    const html=await (await fetch(base+"/",{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}})).text();
    const srcs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]);
    const urls=[...new Set(srcs.map(s=>new URL(s,base).href).filter(u=>u.startsWith(base)))].slice(0,12);
    const matches=[];
    for(const url of urls){
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"*/*"}});
      if(!r.ok) continue;
      const js=await r.text();
      let idx=0, guard=0;
      while((idx=js.indexOf("/api/",idx))!==-1 && guard<250){
        const start=Math.max(0,idx-180), end=Math.min(js.length,idx+260);
        matches.push({url,snippet:js.slice(start,end)});
        idx+=5; guard++;
      }
    }
    const uniq=[]; const seen=new Set();
    for(const m of matches){
      const key=m.snippet.replace(/\s+/g," ");
      if(seen.has(key)) continue;
      seen.add(key); uniq.push(m);
      if(uniq.length>=200) break;
    }
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({scripts:urls,matches:uniq});
  }catch(e){
    return res.status(500).json({error:e?.message||"failed"});
  }
}
