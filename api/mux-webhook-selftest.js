const SUPABASE_URL="https://lrgllzvwgvqagcpiyvfd.supabase.co";
const SUPABASE_KEY="sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";

export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Method not allowed"});
  }
  const secret=process.env.MUX_TOKEN_SECRET;
  if(!secret) return res.status(503).json({ok:false,error:"server secret unavailable"});
  const id="selftest-"+Date.now();
  const event={
    id,
    type:"video.asset.created",
    object:{type:"asset",id:"selftest-asset"},
    created_at:new Date().toISOString(),
    data:{id:"selftest-asset",status:"preparing",passthrough:"not-a-review-id"}
  };
  const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/process_mux_webhook_event",{
    method:"POST",
    headers:{apikey:SUPABASE_KEY,"content-type":"application/json",accept:"application/json"},
    body:JSON.stringify({p_internal_secret:secret,p_event:event})
  });
  const text=await response.text();
  let body; try{body=JSON.parse(text)}catch{body=text}
  res.setHeader("Cache-Control","no-store");
  return res.status(response.ok?200:502).json({ok:response.ok,result:body});
}
