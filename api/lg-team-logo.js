const TEAM_IDS = new Set([
  "784","790","3088","1333","3090","3091","2911","3092","2327","988","2256","3080",
  "3094","3085","2782","3089","2340","1898","1650","3093","1837","2244","1347","1089",
  "2914","1833","3014","810","3095","785","1752","2616"
]);

export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).send("GET only");
  }

  const team=String(req.query.team||"").trim();
  if(!TEAM_IDS.has(team)) return res.status(404).send("Unknown team");

  const upstreamUrl=`https://www.leaguegaming.com/images/team/p100/team${team}.png`;

  try{
    const upstream=await fetch(upstreamUrl,{
      method:"GET",
      redirect:"follow",
      headers:{
        "Accept":"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9",
        "Referer":"https://www.leaguegaming.com/",
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
      },
      signal:AbortSignal.timeout(12000)
    });

    if(!upstream.ok){
      return res.status(upstream.status).send("Logo unavailable");
    }

    const type=upstream.headers.get("content-type")||"image/png";
    if(!type.toLowerCase().startsWith("image/")){
      return res.status(502).send("Invalid logo response");
    }

    const bytes=Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type",type);
    res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options","nosniff");
    return res.status(200).send(bytes);
  }catch(error){
    return res.status(502).send("Logo source unavailable");
  }
}
