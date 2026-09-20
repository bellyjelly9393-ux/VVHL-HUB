import crypto from "node:crypto";

export default function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Method not allowed"});
  }
  const secret=process.env.MUX_TOKEN_SECRET;
  if(!secret) return res.status(503).json({configured:false});
  const hash=crypto.createHash("sha256").update(secret,"utf8").digest("hex");
  res.setHeader("Cache-Control","no-store");
  return res.status(200).json({configured:true,sha256:hash});
}
