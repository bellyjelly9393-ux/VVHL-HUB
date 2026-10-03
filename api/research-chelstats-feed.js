export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({error:"Method not allowed"});
  const clubId=String(req.query.clubId||"12521").replace(/\D/g,"").slice(0,12);
  const year=String(req.query.year||"2026");
  const month=String(req.query.month||"9");
  const base="https://www.chelstats.app/api";
  const urls={
    games:`${base}/clubs/${clubId}/games?matchType=gameType5&limit=10&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`,
    info:`${base}/club/${clubId}/info`,
    periods:`${base}/clubs/${clubId}/period-stats?console=common-gen5&excludeMatchType=club_private`
  };
  const out={source:"chelstats",clubId,results:{}};
  for(const [key,url] of Object.entries(urls)){
    try{
      const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"WildmanHockey/1.0"},redirect:"follow",cache:"no-store"});
      const text=await r.text();
      let data=null; try{data=JSON.parse(text)}catch{}
      out.results[key]={status:r.status,ok:r.ok,contentType:r.headers.get("content-type"),data:data??null,textPreview:data==null?text.slice(0,800):null};
    }catch(e){
      out.results[key]={error:e?.message||"request failed"};
    }
  }
  res.setHeader("Cache-Control","no-store");
  return res.status(200).json(out);
}
