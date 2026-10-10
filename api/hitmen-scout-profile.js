const crypto=require('crypto');
const {SYSTEM}=require('./chelscout-deepthink')._test;
const WORKER_SECRET_SHA256=Buffer.from('d5c758b22936f82d39df596e8147a678ea822f8cad6e8792ad9c70897cd01cd0','hex');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use authenticated POST.'});
 const secret=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!secret||secret.length>512)return res.status(401).json({error:'Worker authentication required.'});
 try{
  // Check the worker secret here instead of calling a public database function, so that
  // function no longer has to be callable by signed-out visitors. Only the SHA-256 hash of
  // the secret lives in code; the secret itself stays with the worker.
  const got=crypto.createHash('sha256').update(secret).digest();
  if(!crypto.timingSafeEqual(got,WORKER_SECRET_SHA256))return res.status(403).json({error:'Worker authentication failed.'});
  return res.status(200).json({engine:'Hitmen GM · Wildman Hockey Ops',provider:'openrouter',model:process.env.CLAUDE_MODEL||'anthropic/claude-opus-5.5',instructions:SYSTEM});
 }catch{return res.status(503).json({error:'GM profile unavailable.'});}
};
