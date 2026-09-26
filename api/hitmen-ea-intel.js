const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
const BASE='https://lrgllzvwgvqagcpiyvfd.supabase.co';
const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const EA='https://proclubs.ea.com/api/nhl';

const fail=(status,message)=>Object.assign(new Error(message),{status});
async function jsonFetch(url,options={}){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(22000)});
  const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{}
  if(!r.ok)throw fail(r.status===403?502:r.status,body?.message||body?.error||('EA source returned '+r.status));
  if(body==null)throw fail(502,'EA returned a non-JSON response.');
  return body;
}
async function verify(token){
  const base=process.env.SUPABASE_URL||BASE;
  const headers={apikey:process.env.SUPABASE_ANON_KEY||KEY,Authorization:token};
  const user=await jsonFetch(base+'/auth/v1/user',{headers});
  if(!user?.id)throw fail(401,'Sign in to the War Room.');
  const [profile,members]=await Promise.all([
    jsonFetch(base+'/rest/v1/profiles?select=role&id=eq.'+user.id,{headers}),
    jsonFetch(base+'/rest/v1/team_memberships?select=role&active=eq.true&team_id=eq.'+TEAM+'&user_id=eq.'+user.id,{headers})
  ]);
  if(profile?.[0]?.role!=='admin'&&!members.some(m=>['owner','gm','agm'].includes(String(m.role||'').toLowerCase())))throw fail(403,'Calgary management access required.');
  return user;
}
function eaHeaders(){
  return {
    accept:'application/json,text/plain,*/*',
    'accept-language':'en-US,en;q=0.9',
    referer:'https://www.ea.com/',
    origin:'https://www.ea.com',
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    connection:'keep-alive'
  };
}
async function ea(path,params){
  const u=new URL(EA+path);
  for(const [k,v] of Object.entries(params||{}))if(v!=null&&v!=='')u.searchParams.set(k,String(v));
  return jsonFetch(u,{headers:eaHeaders(),redirect:'follow'});
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only'});}
  const token=String(req.headers.authorization||'');
  if(!/^Bearer \S+$/.test(token))return res.status(401).json({error:'Sign in to the War Room.'});
  try{
    await verify(token);
    const {action='search',clubName='',clubId='',platform='common-gen5'}=req.body||{};
    if(!/^common-gen5$/.test(String(platform)))throw fail(400,'Only NHL 27 common-gen5 is supported.');
    if(action==='search'){
      const q=String(clubName||'').trim();
      if(!q||q.length>80)throw fail(400,'Club name required.');
      const body=await ea('/clubs/search',{platform,clubName:q});
      return res.status(200).json({action,platform,query:q,body});
    }
    if(action==='snapshot'){
      if(!/^\d+$/.test(String(clubId)))throw fail(400,'Numeric EA club ID required.');
      const calls=[
        ['club',()=>ea('/clubs/info',{platform,clubIds:clubId})],
        ['members',()=>ea('/members/stats',{platform,clubId})],
        ['season',()=>ea('/clubs/seasonalStats',{platform,clubIds:clubId})],
        ['privateMatches',()=>ea('/clubs/matches',{platform,clubIds:clubId,matchType:'club_private',maxResultCount:60})],
        ['regularMatches',()=>ea('/clubs/matches',{platform,clubIds:clubId,matchType:'gameType5',maxResultCount:60})],
        ['playoffMatches',()=>ea('/clubs/matches',{platform,clubIds:clubId,matchType:'gameType10',maxResultCount:40})]
      ];
      const settled=await Promise.allSettled(calls.map(async([key,fn])=>[key,await fn()]));
      const out={},warnings=[];
      settled.forEach((r,i)=>{const key=calls[i][0];if(r.status==='fulfilled')out[key]=r.value[1];else warnings.push(key+': '+(r.reason?.message||'unavailable'));});
      if(!Object.keys(out).length)throw fail(502,'EA club data is unavailable from this deployment.');
      return res.status(200).json({action,platform,clubId:String(clubId),fetched_at:new Date().toISOString(),data:out,warnings});
    }
    throw fail(400,'Unknown EA action.');
  }catch(e){return res.status(e.status||502).json({error:e.message||'EA public club data is temporarily unavailable.'});}
}