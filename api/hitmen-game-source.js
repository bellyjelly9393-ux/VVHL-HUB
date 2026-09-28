const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
const BASE='https://lrgllzvwgvqagcpiyvfd.supabase.co';
const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const ALLOWED=new Set(['chelstats.app','proclubs.ea.com']);

const fail=(status,message)=>Object.assign(new Error(message),{status});
async function jsonFetch(url,options={}){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(22000)});
  const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{}
  if(!r.ok)throw fail(r.status===403?502:r.status,body?.message||body?.error||('Public source returned '+r.status));
  if(body==null)throw fail(502,'Public source returned a non-JSON response.');
  return body;
}
async function verify(token){
  const base=process.env.SUPABASE_URL||BASE;
  const headers={apikey:process.env.SUPABASE_ANON_KEY||KEY,Authorization:token};
  const user=await jsonFetch(base+'/auth/v1/user',{headers});
  if(!user?.id)throw fail(401,'Sign in to the Hitmen workspace.');
  const [profile,members]=await Promise.all([
    jsonFetch(base+'/rest/v1/profiles?select=role&id=eq.'+user.id,{headers}),
    jsonFetch(base+'/rest/v1/team_memberships?select=role&active=eq.true&team_id=eq.'+TEAM+'&user_id=eq.'+user.id,{headers})
  ]);
  if(profile?.[0]?.role!=='admin'&&!members.some(m=>['owner','gm','agm'].includes(String(m.role||'').toLowerCase())))throw fail(403,'Calgary management access required.');
}
function safeUrl(raw){
  let u;try{u=new URL(String(raw||'').trim())}catch{throw fail(400,'Enter a valid public game URL.')}
  if(u.protocol!=='https:'||!ALLOWED.has(u.hostname.toLowerCase())||u.username||u.password||u.port)throw fail(400,'Use an HTTPS ChelStats or EA Pro Clubs public URL.');
  if(u.hostname.toLowerCase()==='chelstats.app'&&!/^\/api\/clubs\/\d+\/games\/\d+\/?$/.test(u.pathname))throw fail(400,'Use a ChelStats public game API link.');
  if(u.hostname.toLowerCase()==='proclubs.ea.com'&&!u.pathname.startsWith('/api/nhl/'))throw fail(400,'Use an EA Pro Clubs public API link.');
  return u;
}
function findGameNode(value,depth=0){
  if(!value||typeof value!=='object'||depth>7)return null;
  if(value.clubs&&value.players&&typeof value.clubs==='object'&&typeof value.players==='object')return value;
  if(Array.isArray(value)){for(const item of value){const hit=findGameNode(item,depth+1);if(hit)return hit;}return null}
  for(const child of Object.values(value)){const hit=findGameNode(child,depth+1);if(hit)return hit}
  return null;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only'});}
  const token=String(req.headers.authorization||'');
  if(!/^Bearer \S+$/.test(token))return res.status(401).json({error:'Sign in to the Hitmen workspace.'});
  try{
    await verify(token);
    const u=safeUrl(req.body?.url);
    const body=await jsonFetch(u,{headers:{accept:'application/json','user-agent':'Wildman-Hockey-Hitmen-Game-Stats/1.0'},redirect:'follow'});
    const game=findGameNode(body?.game||body);
    if(!game)throw fail(422,'The public source returned JSON, but no EA-style game clubs/players object was found.');
    return res.status(200).json({source:u.hostname==='chelstats.app'?'chelstats-public-game':'ea-public-game',url:u.toString(),game});
  }catch(e){return res.status(e.status||502).json({error:e.message||'Public game source is unavailable.'});}
}