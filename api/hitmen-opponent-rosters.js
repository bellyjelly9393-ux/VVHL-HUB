const ROSTER_URL='https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=roster&leagueid=39&seasonid=55';

const clean=(s='')=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();

function parseRosters(html){
  const players=[];
  for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const body=table[1];
    let team=clean(body.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1]||'');
    if(!team){
      team=clean(body.match(/class=["'][^"']*(?:team|header)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1]||'');
    }
    if(!team)continue;
    for(const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const htmlRow=row[1];
      const link=htmlRow.match(/<a\b[^>]*href=["'][^"']*(?:userid|user_id)=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      if(!link||!clean(link[2]))continue;
      const label=clean(htmlRow);
      if(!/^\d+\./.test(label)&&!/\b(LW|RW|LD|RD|C|G)\b/.test(label))continue;
      const amount=label.match(/\b([\d.]+)\s*(M|K)\b/i);
      players.push({
        uid:Number(link[1]),
        name:clean(link[2]),
        team,
        position:label.match(/\b(LW|RW|LD|RD|C|G)\b/)?.[1]||null,
        salary:amount?Math.round(Number(amount[1])*(String(amount[2]).toUpperCase()==='M'?1000000:1000)):null,
        management_role:/\bOwner\b/i.test(label)?'Owner':/\bGM\b/i.test(label)?'GM':/\bAGM\b/i.test(label)?'AGM':null,
        roster_role:/training camp|tc\b/i.test(label)?'Training Camp':'Active'
      });
    }
  }
  const dedup=[...new Map(players.map(p=>[p.team+'|'+p.uid,p])).values()];
  if(dedup.length<50)throw new Error('LG roster response did not contain a complete Season 55 roster set.');
  return dedup;
}

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET only'});}
  try{
    const r=await fetch(ROSTER_URL,{
      redirect:'follow',
      headers:{
        accept:'text/html,application/xhtml+xml',
        'accept-language':'en-US,en;q=0.9',
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
      },
      signal:AbortSignal.timeout(20000)
    });
    const html=await r.text();
    if(!r.ok)throw new Error('LeagueGaming roster source returned '+r.status+'.');
    const players=parseRosters(html);
    const teams={};
    for(const p of players)(teams[p.team]||(teams[p.team]=[])).push(p);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({season:55,league_id:39,fetched_at:new Date().toISOString(),source:ROSTER_URL,team_count:Object.keys(teams).length,player_count:players.length,teams,players});
  }catch(e){
    return res.status(502).json({error:e.message||'LeagueGaming roster source is temporarily unavailable.'});
  }
}

export {parseRosters,clean};