const {SYSTEM}=require('./chelscout-deepthink')._test;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use authenticated POST.'});
 const secret=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!secret||secret.length>512)return res.status(401).json({error:'Worker authentication required.'});
 try{
  const response=await fetch('https://lrgllzvwgvqagcpiyvfd.supabase.co/rest/v1/rpc/worker_authorize_scout_profile',{
   method:'POST',headers:{apikey:'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP','Content-Type':'application/json'},
   body:JSON.stringify({worker_secret:secret}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok||await response.json()!==true)return res.status(403).json({error:'Worker authentication failed.'});
  return res.status(200).json({engine:'Hitmen GM · Wildman Hockey Ops',provider:'openrouter',model:process.env.CLAUDE_MODEL||'anthropic/claude-opus-5.5',instructions:SYSTEM});
 }catch{return res.status(503).json({error:'GM profile unavailable.'});}
};
