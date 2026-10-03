import { ROSTER_URL, parseRosters, clean } from '../lib/opponent-refresh.mjs';

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
