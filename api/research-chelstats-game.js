export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const clubId=String(req.query.clubId||"12521").replace(/\D/g,"").slice(0,12);
  const matchId=String(req.query.matchId||"1288079030011").replace(/\D/g,"").slice(0,24);
  const url=`https://chelstats.app/api/clubs/${clubId}/games/${matchId}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"WildmanHockey/1.0"},cache:"no-store"});
    const text=await r.text();
    let data=null; try{data=JSON.parse(text)}catch{}
    res.setHeader("Cache-Control","no-store");
    return res.status(200).json({upstreamStatus:r.status,ok:r.ok,url,data:data??null,textPreview:data==null?text.slice(0,1200):null});
  }catch(e){
    return res.status(500).json({error:e?.message||"failed"});
  }
}
