// Public LeagueGaming Pro Series score feed.
// Uses LeagueGaming's own Public Log pages. No LG login/session cookies are sent or stored.
const LG_BASE = 'https://www.leaguegaming.com/forums/index.php';
const DISCOVERY_URLS = [
  LG_BASE + '?leaguegaming/league&action=league&page=standing&leagueid=60&seasonid=14',
  'https://www.leaguegaming.com/forums/index.php?forums/community-events-pro-series.506/'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0';

function asId(v){ return String(v || '').replace(/\D/g,''); }
function pairKey(ids){ return ids.map(asId).filter(Boolean).sort((a,b)=>Number(a)-Number(b)).join('-'); }
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }

function decodeHtml(s=''){
  return String(s)
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}

function htmlToText(html=''){
  return decodeHtml(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:tr|td|th|div|p|li|h\d|table|section|br)>/gi,'\n')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' '))
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s*\n+/g,'\n')
    .trim();
}

async function fetchHtml(url,referer='https://www.leaguegaming.com/'){
  const r = await fetch(url,{
    method:'GET',
    redirect:'follow',
    headers:{
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language':'en-US,en;q=0.9',
      'user-agent':UA,
      'referer':referer,
      'upgrade-insecure-requests':'1',
      'sec-ch-ua':'\"Microsoft Edge\";v=\"153\", \"Not_A Brand\";v=\"8\", \"Chromium\";v=\"153\"',
      'sec-ch-ua-mobile':'?0',
      'sec-ch-ua-platform':'\"Windows\"',
      'sec-fetch-dest':'document',
      'sec-fetch-mode':'navigate',
      'sec-fetch-site':'same-origin',
      'cache-control':'max-age=0'
    },
    signal:AbortSignal.timeout(15000)
  });
  const text = await r.text();
  if(!r.ok) throw new Error('LeagueGaming returned HTTP '+r.status);
  if(/cdn-cgi\/challenge-platform|Just a moment\.\.\.|cf-chl-/i.test(text)) {
    throw new Error('LeagueGaming returned a Cloudflare challenge instead of public data');
  }
  return text;
}

function gameTeamIds(html=''){
  const priority = [];
  for(const re of [
    /team_block(\d+)/gi,
    /images\/team\/[^"'<>\s]*team(\d+)\.(?:png|webp|jpg|jpeg)/gi,
    /\bteam(\d+)\.(?:png|webp|jpg|jpeg)/gi
  ]){
    for(const m of html.matchAll(re)) priority.push(m[1]);
    const u=uniq(priority);
    if(u.length>=2) return u.slice(0,2);
  }
  return uniq(priority).slice(0,2);
}

function teamIdsNear(html, index){
  const radius = 1400;
  const start = Math.max(0,index-radius);
  const end = Math.min(html.length,index+radius);
  const chunk = html.slice(start,end);
  const center = index-start;
  const found=[];
  const patterns=[
    /team_block(\d+)/gi,
    /images\/team\/[^"'<>\s]*team(\d+)\.(?:png|webp|jpg|jpeg)/gi,
    /\bteam(\d+)\.(?:png|webp|jpg|jpeg)/gi
  ];
  for(const re of patterns){
    for(const m of chunk.matchAll(re)){
      found.push({id:m[1],dist:Math.abs((m.index||0)-center)});
    }
  }
  const seen=new Set();
  return found.sort((a,b)=>a.dist-b.dist).filter(x=>{
    if(seen.has(x.id)) return false;
    seen.add(x.id); return true;
  }).slice(0,2).map(x=>x.id);
}

function discoverGames(html=''){
  const byGame = new Map();
  for(const m of html.matchAll(/gameid=(\d+)/gi)){
    const gameId=m[1];
    if(byGame.has(gameId)) continue;
    const ids=teamIdsNear(html,m.index||0);
    if(ids.length===2) byGame.set(gameId,{gameId,teamSourceIds:ids,pair:pairKey(ids)});
  }
  return [...byGame.values()];
}

function parsePublicLog(gameId, html){
  const text = htmlToText(html);
  const teamIds = gameTeamIds(html);
  const saves = [...text.matchAll(/Save\s*#\s*(\d+)/gi)].map(m=>Number(m[1])).filter(Number.isFinite);
  const latestSave = saves.length ? Math.max(...saves) : null;

  let updatedAt = null;
  const dates = [...text.matchAll(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g)];
  if(dates.length) updatedAt = dates[dates.length-1][0].replace(' ','T')+'-04:00';

  const start = text.search(/\bTeam Stats\b/i);
  const end = text.search(/\bPeriod Stats\b/i);
  const teamSection = start>=0 ? text.slice(start,end>start?end:Math.min(text.length,start+5000)) : '';
  const goals = [...teamSection.matchAll(/\bgoals\s+(-?\d+)\b/gi)].map(m=>Number(m[1])).filter(Number.isFinite);
  const scores = goals.length>=2 ? goals.slice(0,2) : [];

  // Public logs are created/updated as league stats are saved. If a two-team score
  // exists in Team Stats we can safely treat that entered result as a final result.
  const status = scores.length===2 ? 'final' : 'pending';

  return {
    gameId:String(gameId),
    teamSourceIds:teamIds,
    pair:pairKey(teamIds),
    scores,
    status,
    latestSave,
    updatedAt,
    source:'LeagueGaming Public Log',
    sourceUrl:LG_BASE+'?leaguegaming/league&action=league&page=league_game_edit_log&gameid='+encodeURIComponent(gameId)
  };
}

async function directGame(gameId){
  const url = LG_BASE+'?leaguegaming/league&action=league&page=league_game_edit_log&gameid='+encodeURIComponent(gameId);
  const html = await fetchHtml(url,LG_BASE+'?leaguegaming/league&action=league&page=game&gameid='+encodeURIComponent(gameId));
  return parsePublicLog(gameId,html);
}

async function discover(){
  let lastError=null;
  for(const url of DISCOVERY_URLS){
    try{
      const html=await fetchHtml(url);
      const games=discoverGames(html);
      if(games.length) return {url,games};
    }catch(e){ lastError=e; }
  }
  throw lastError || new Error('No public Pro Series game links were discovered');
}

async function mapLimit(items, limit, fn){
  const out=new Array(items.length);
  let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const i=next++;
      if(i>=items.length) break;
      try{ out[i]=await fn(items[i]); }
      catch(e){ out[i]={gameId:String(items[i].gameId||items[i]),error:e.message}; }
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=45');
  if(req.method!=='GET') return res.status(405).json({error:'Use GET.'});

  try{
    const direct=asId(req.query?.gameid);
    if(direct){
      const update=await directGame(direct);
      return res.status(200).json({ok:true,updates:[update],retrievedAt:new Date().toISOString()});
    }

    const requested=String(req.query?.teams||'').split(',').map(x=>pairKey(x.split('-'))).filter(Boolean);
    const requestedSet=new Set(requested.slice(0,24));
    if(!requestedSet.size) return res.status(400).json({error:'Provide gameid or teams=TEAMID-TEAMID,...'});

    const discovery=await discover();
    const targets=discovery.games.filter(g=>requestedSet.has(g.pair)).slice(0,24);
    if(!targets.length){
      return res.status(200).json({
        ok:true,
        updates:[],
        discovered:discovery.games.length,
        discoveryUrl:discovery.url,
        message:'No matching public LG game IDs were found for those team pairs yet.',
        retrievedAt:new Date().toISOString()
      });
    }

    const raw=await mapLimit(targets,6,g=>directGame(g.gameId));
    const updates=raw
      .filter(x=>x && !x.error)
      .map(x=>{
        // Discovery is the authoritative game-to-team mapping. Keep it if the
        // Public Log HTML omits logos/team IDs in a particular layout.
        const d=targets.find(t=>t.gameId===x.gameId);
        if((x.teamSourceIds||[]).length!==2 && d){
          x.teamSourceIds=d.teamSourceIds;
          x.pair=d.pair;
        }
        return x;
      });

    return res.status(200).json({
      ok:true,
      updates,
      errors:raw.filter(x=>x?.error),
      discovered:discovery.games.length,
      matched:targets.length,
      discoveryUrl:discovery.url,
      retrievedAt:new Date().toISOString()
    });
  }catch(e){
    console.error('LG public log feed failed',e);
    return res.status(502).json({ok:false,error:e.message||'LeagueGaming public log feed failed.'});
  }
};

module.exports._test={htmlToText,discoverGames,parsePublicLog,pairKey,gameTeamIds};
