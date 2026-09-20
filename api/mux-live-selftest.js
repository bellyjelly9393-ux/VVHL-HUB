import crypto from "node:crypto";

export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  const secret=process.env.MUX_WEBHOOK_SECRET || process.env.MUX_WEBHOOK_SIGNING_SECRET;
  if(!secret) return res.status(503).json({error:"Mux webhook secret unavailable"});

  const event={
    id:"evt_selftest_"+Date.now(),
    type:"video.asset.ready",
    object:{type:"asset",id:"asset_selftest_"+Date.now()},
    created_at:new Date().toISOString(),
    data:{
      id:"asset_selftest_"+Date.now(),
      status:"ready",
      passthrough:"not-a-real-review-id",
      duration:12.34,
      playback_ids:[]
    }
  };
  const body=JSON.stringify(event);
  const timestamp=Math.floor(Date.now()/1000).toString();
  const signature=crypto.createHmac("sha256",secret).update(timestamp+"."+body,"utf8").digest("hex");
  const target="https://wildmanhockey-esportshub.vercel.app/api/mux-webhook";

  const response=await fetch(target,{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "mux-signature":"t="+timestamp+",v1="+signature
    },
    body
  });
  const text=await response.text();
  let parsed; try{parsed=JSON.parse(text)}catch{parsed=text}
  res.setHeader("Cache-Control","no-store");
  return res.status(response.ok?200:502).json({
    ok:response.ok,
    status:response.status,
    eventId:event.id,
    receiver:parsed
  });
}
