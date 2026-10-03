function norm(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();}
async function lookup(name){
  const url=new URL("https://chelstats.app/api/clubs/stats");
  url.searchParams.set("teamname",name);
  url.searchParams.set("console","common-gen5");
  url.searchParams.set("strict","true");
  const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"WildmanHockey/1.0"},cache:"no-store"});
  const text=await r.text(); let data=null; try{data=JSON.parse(text)}catch{}
  const t=data?.teamData||data?.team||null;
  return {
    query:name,status:r.status,ok:r.ok,
    clubId:t?.clubId!=null?String(t.clubId):null,
    name:t?.name||null,
    exact:Boolean(t?.name && norm(t.name)===norm(name)),
    recentGameTypes:data?.recentGames?Object.keys(data.recentGames):[],
    textPreview:data==null?text.slice(0,300):null
  };
}
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const names=String(req.query.names||"").split("|").map(s=>s.trim()).filter(Boolean).slice(0,40);
  const out=[];
  for(let i=0;i<names.length;i+=6){
    out.push(...await Promise.all(names.slice(i,i+6).map(lookup)));
  }
  res.setHeader("Cache-Control","no-store");
  return res.status(200).json({results:out});
}
