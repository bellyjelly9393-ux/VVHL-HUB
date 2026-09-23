const SOURCE='https://chelscout.net/gm-hub/api/bid-board';

const numberOrNull=v=>{
  const n=Number(v);
  return v===null||v===undefined||v===''||!Number.isFinite(n)?null:n;
};

function sanitizeRow(r){
  const contracted=r&&typeof r.contracted==='object'&&r.contracted?{
    M:numberOrNull(r.contracted.M),
    league_id:numberOrNull(r.contracted.league_id),
    season:numberOrNull(r.contracted.season),
    seasons:numberOrNull(r.contracted.seasons),
    team:r.contracted.team?String(r.contracted.team):null,
    type:r.contracted.type?String(r.contracted.type):null
  }:null;
  const bid=r&&typeof r.bid_elsewhere==='object'&&r.bid_elsewhere?{
    M:numberOrNull(r.bid_elsewhere.M),
    league_id:numberOrNull(r.bid_elsewhere.league_id)
  }:null;
  const price=r&&typeof r.price==='object'&&r.price?{
    likely_M:numberOrNull(r.price.likely_M),
    likely_band_M:Array.isArray(r.price.likely_band_M)?r.price.likely_band_M.slice(0,2).map(numberOrNull):null,
    likely_basis:r.price.likely_basis?String(r.price.likely_basis).slice(0,500):null,
    live_bid_M:numberOrNull(r.price.live_bid_M),
    top_of_pool:r.price.top_of_pool===true
  }:{live_bid_M:null,likely_M:null};
  const role=r&&typeof r.role==='object'&&r.role?{
    band:r.role.band||null,
    chip:r.role.chip||null,
    league:r.role.league||null,
    group:r.role.group||null,
    view:r.role.view&&typeof r.role.view==='object'?{
      band:r.role.view.band||null,
      chip:r.role.view.chip||null,
      clears:r.role.view.clears||null,
      receipt:r.role.view.receipt?String(r.role.view.receipt).slice(0,260):null
    }:null
  }:null;
  const last=r&&typeof r.last==='object'&&r.last?{
    gp:numberOrNull(r.last.gp),
    pts:numberOrNull(r.last.pts),
    ppg:numberOrNull(r.last.ppg),
    plus_minus:numberOrNull(r.last.plus_minus),
    sv:numberOrNull(r.last.sv),
    gaa:numberOrNull(r.last.gaa),
    record:r.last.record||null
  }:null;
  return {
    uid:numberOrNull(r.uid),
    name:r.name?String(r.name):'',
    pos:r.pos?String(r.pos):null,
    server:r.server?String(r.server):null,
    console:r.console?String(r.console):null,
    bid_elsewhere:bid,
    contracted,
    off_auction:r.off_auction===true,
    reach:r.reach?String(r.reach):null,
    score:numberOrNull(r.score),
    last_league:numberOrNull(r.last_league),
    last_season:numberOrNull(r.last_season),
    price,
    role,
    last,
    tags:Array.isArray(r.tags)?r.tags.slice(0,16).map(String):[]
  };
}

function validMarketRow(r){
  return Boolean(numberOrNull(r?.uid) && r?.name);
}

function isEligibleRow(r){
  const contractLeague=Number(r?.contracted?.league_id||0);
  return !contractLeague && r?.off_auction!==true;
}

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'GET only'});
  }
  try{
    const upstream=await fetch(SOURCE,{
      headers:{accept:'application/json','user-agent':'Wildman-Hockey-Hitmen-Market/1.0'},
      redirect:'follow',
      signal:AbortSignal.timeout(20000)
    });
    const text=await upstream.text();
    let body;
    try{body=JSON.parse(text);}catch{
      return res.status(502).json({error:'Live market source returned a non-JSON response.',upstream_status:upstream.status});
    }
    if(!upstream.ok||!body||!Array.isArray(body.rows)){
      return res.status(upstream.status||502).json({error:'Live bid board is not available to the server right now.',upstream_status:upstream.status});
    }
    const rows=body.rows.map(sanitizeRow).filter(validMarketRow);
    const eligibleRows=rows.filter(isEligibleRow).length;
    res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      auction_ran:body.auction_ran===true,
      bids_updated:body.bids_updated||null,
      board_rev:body.board_rev||body.bids_updated||null,
      league:body.league||'LGCHL',
      league_id:numberOrNull(body.league_id),
      row_total:numberOrNull(body.row_total)||body.rows.length,
      watch_rows:rows.length,
      eligible_rows:eligibleRows,
      rows
    });
  }catch(error){
    return res.status(502).json({error:'Live market source is temporarily unreachable.'});
  }
}
