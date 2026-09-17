// Public LG pages only. An unrostered signup is never assumed bid-eligible.
export const clean = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const positions = {'Left Wing':'LW',Center:'C','Right Wing':'RW','Left Defense':'LD','Right Defense':'RD',Goalie:'G'};
const normalize = s => s.trim().toLowerCase();
export function parseSignups(html) {
  if (!html.includes('Primary Position') || !html.includes('Preferred EA Server')) throw Error('LG signup layout could not be verified');
  const players = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)(?=<\/td>|<\/tr>|$)/gi)].map(x=>clean(x[1]));
    if (cells.length < 6 || !positions[cells[2]]) continue;
    players.push({key:'signup:'+normalize(cells[1]),name:cells[1],position:positions[cells[2]],server:cells[3],platform:cells[4],lg_id:null,status:'unverified'});
  }
  if (players.length < 100) throw Error('LG signup response is incomplete; previous data retained');
  return players;
}
export function parseRosters(html) {
  const players=[];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const team=clean(table[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1]||'');
    if(!team) continue;
    for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const link=row[1].match(/<a\b[^>]*href=["'][^"']*userid=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      if(!link || !clean(link[2])) continue;
      const label=clean(row[1]);
      if(!/^\d+\./.test(label)) continue;
      const amount=label.match(/\b([\d.]+)\s*(M|K)\b/);
      const training_camp=/player-level-id=["']0["']/.test(row[0]);
      players.push({lg_id:Number(link[1]),name:clean(link[2]),team,training_camp,position:label.match(/\b(LW|RW|LD|RD|C|G)\b/)?.[1]||'',salary:amount?Math.round(Number(amount[1])*(amount[2]==='M'?1000000:1000)):null,status:'unavailable'});
    }
  }
  if(players.length < 10) throw Error('LG roster response is incomplete; previous data retained');
  return players;
}
export function combine(signups,rosters) {
  const byName=new Map();
  rosters.forEach(p=>{const k=normalize(p.name);byName.set(k,[...(byName.get(k)||[]),p]);});
  const used=new Set();
  const players=signups.map(p=>{const matches=byName.get(normalize(p.name))||[]; if(matches.length!==1)return p;const r=matches[0];used.add(r.lg_id);return {...p,...r};});
  for(const r of rosters)if(!used.has(r.lg_id)){used.add(r.lg_id);players.push({...r,key:'lg:'+r.lg_id,server:'',platform:''});}
  return players;
}
async function page(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{'User-Agent':'WildmanHockey/1.0 public-roster-reader'}});
  if(!response.ok)throw Error('LG source unavailable ('+response.status+')');
  return response.text();
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'GET required'});
  const signup='https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=latest_signups&leagueid=37&seasonid=55';
  const roster='https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=roster&leagueid=39&seasonid=55';
  try{
    const [s,r]=await Promise.all([page(signup),page(roster)]);
    const players=combine(parseSignups(s),parseRosters(r));
    res.setHeader('Cache-Control','s-maxage=300');
    return res.status(200).json({season:55,fetched_at:new Date().toISOString(),sources:[signup,roster],players});
  }catch(e){return res.status(502).json({error:e.message});}
}
