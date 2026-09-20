(() => {
  const db=()=>window.VVHLBackend?.db;
  const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
  const norm=v=>String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
  const round250k=v=>Math.max(0,Math.round(Number(v||0)/250000)*250000);
  const positionGroup=p=>{
    const x=String(p||'').toUpperCase();
    if(['LW','C','RW'].includes(x))return 'F';
    if(['LD','RD','D'].includes(x))return 'D';
    if(x==='G')return 'G';
    return 'U';
  };

  async function canonicalByScoutingPlayer(scoutingPlayerId){
    if(!db()||!scoutingPlayerId)return null;
    const {data:link,error}=await db().from('player_source_links')
      .select('player_id,source_system,source_record_id')
      .eq('source_system','scouting_players')
      .eq('source_record_id',String(scoutingPlayerId))
      .maybeSingle();
    if(error)throw error;
    if(!link)return null;
    const {data:profile,error:profileError}=await db().from('player_intelligence_profiles')
      .select('*').eq('id',link.player_id).maybeSingle();
    if(profileError)throw profileError;
    return profile||null;
  }

  async function contextForScoutingPlayer(scoutingPlayerId,teamId){
    const profile=await canonicalByScoutingPlayer(scoutingPlayerId);
    if(!profile)return {profile:null,links:[],seasons:[],valuations:[],chemistry:[],vod:[],relationships:[],reports:[],preScout:null,external:[]};
    const pid=profile.id;
    const [links,seasons,valuations,chemA,chemB,reports,preScout,external]=await Promise.all([
      db().from('player_source_links').select('*').eq('player_id',pid),
      db().from('player_season_history').select('*').eq('player_id',pid).order('season',{ascending:false}).order('imported_at',{ascending:false}),
      teamId?db().from('player_valuation_snapshots').select('*').eq('team_id',teamId).eq('player_id',pid).order('calculated_at',{ascending:false}):Promise.resolve({data:[],error:null}),
      teamId?db().from('player_chemistry_scores').select('*').eq('team_id',teamId).eq('player_a_id',pid).order('overall_score',{ascending:false}):Promise.resolve({data:[],error:null}),
      teamId?db().from('player_chemistry_scores').select('*').eq('team_id',teamId).eq('player_b_id',pid).order('overall_score',{ascending:false}):Promise.resolve({data:[],error:null}),
      teamId?db().from('team_scouting_reports').select('*').eq('team_id',teamId).eq('scouting_player_id',scoutingPlayerId).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null}),
      teamId?db().from('team_pre_scout_reports').select('*').eq('team_id',teamId).eq('scouting_player_id',scoutingPlayerId).maybeSingle():Promise.resolve({data:null,error:null}),
      teamId?db().from('team_external_scouting_reports').select('*').eq('team_id',teamId).eq('scouting_player_id',scoutingPlayerId).order('imported_at',{ascending:false}):Promise.resolve({data:[],error:null})
    ]);
    const results=[links,seasons,valuations,chemA,chemB,reports,preScout,external];
    const err=results.find(x=>x?.error)?.error;
    if(err)throw err;
    const sourceLinks=links.data||[];
    const legacyPlayerIds=sourceLinks.filter(x=>x.source_system==='players').map(x=>x.source_record_id);
    let vod=[];
    if(legacyPlayerIds.length){
      const q=await db().from('vod_observations').select('*').in('player_id',legacyPlayerIds).order('created_at',{ascending:false}).limit(100);
      if(q.error)throw q.error;
      vod=q.data||[];
    }
    return {
      profile,
      links:sourceLinks,
      seasons:seasons.data||[],
      valuations:valuations.data||[],
      chemistry:[...(chemA.data||[]),...(chemB.data||[])].sort((a,b)=>Number(b.overall_score||0)-Number(a.overall_score||0)),
      vod,
      reports:reports.data||[],
      preScout:preScout.data||null,
      external:external.data||[]
    };
  }

  function valuationV1({position,seasonRecord,fitGrade,scarcityScore,marketFactor=1,calibrationSample=0}={}){
    const pos=String(position||seasonRecord?.position||'').toUpperCase();
    const group=positionGroup(pos);
    const ppg=Number(seasonRecord?.ppg);
    const gp=Number(seasonRecord?.games_played??seasonRecord?.gp);
    const targets={F:3.0,D:2.0,G:1,U:2.5};
    const performance=group==='G'?50:(Number.isFinite(ppg)?clamp((ppg/targets[group])*100):50);
    const reliability=Number.isFinite(gp)&&gp>0?clamp((gp/24)*100):50;
    const teamFit=fitGrade!=null?clamp(Number(fitGrade)*10):50;
    const defaultScarcity={C:72,RD:70,LD:68,LW:55,RW:55,G:55,D:65};
    const scarcity=scarcityScore!=null?clamp(scarcityScore):clamp(defaultScarcity[pos]??55);
    const score=performance*.50+reliability*.20+teamFit*.20+scarcity*.10;
    const fairValue=round250k(500000+(score/100)*7500000);
    const safeFactor=Math.max(.65,Math.min(1.5,Number(marketFactor)||1));
    const expectedMarket=round250k(fairValue*safeFactor);
    const marketLow=round250k(expectedMarket*.85);
    const marketHigh=round250k(expectedMarket*1.15);
    const walkPrice=round250k(Math.max(fairValue*1.25,expectedMarket*1.10));
    return {
      modelVersion:'wildman-v1',
      fairValue,expectedMarket,marketLow,marketHigh,walkPrice,
      performanceScore:Number(performance.toFixed(1)),
      reliabilityScore:Number(reliability.toFixed(1)),
      teamFitScore:Number(teamFit.toFixed(1)),
      roleScarcityScore:Number(scarcity.toFixed(1)),
      formula:'Fair value = $500k + weighted score × $7.5M. Score = 50% production, 20% games/reliability, 20% Calgary fit, 10% positional scarcity. Expected market = fair value × observed S55 market factor when at least 5 matched auctions exist; otherwise factor = 1.00. Market band = 85–115% of expected market; walk = max(125% of fair value, 110% of expected market).',
      inputs:{position:pos,ppg:Number.isFinite(ppg)?ppg:null,gp:Number.isFinite(gp)?gp:null,fitGrade:fitGrade??null,scarcityScore:scarcity,marketFactor:safeFactor,calibrationSample}
    };
  }

  async function valuationCalibration({season=55,league='CHL'}={}){
    if(!db())return {sample:0,marketFactor:1,meanAbsoluteError:null,matched:[]};
    const {data:auctions,error}=await db().from('player_auction_results')
      .select('player_id,final_price,observed_at,result_status')
      .eq('season',season).eq('league',league).eq('result_status','won').not('final_price','is',null);
    if(error)throw error;
    const rows=auctions||[];
    if(!rows.length)return {sample:0,marketFactor:1,meanAbsoluteError:null,matched:[]};
    const ids=[...new Set(rows.map(x=>x.player_id))];
    const {data:vals,error:vErr}=await db().from('player_valuation_snapshots')
      .select('player_id,fair_value,calculated_at,model_version,source_kind')
      .eq('season',season).in('player_id',ids).not('fair_value','is',null).order('calculated_at',{ascending:false});
    if(vErr)throw vErr;
    const matched=[];
    for(const a of rows){
      const choices=(vals||[]).filter(v=>v.player_id===a.player_id&&new Date(v.calculated_at)<=new Date(a.observed_at));
      const v=choices[0]||(vals||[]).find(v=>v.player_id===a.player_id);
      if(!v?.fair_value)continue;
      matched.push({playerId:a.player_id,actual:Number(a.final_price),predicted:Number(v.fair_value),ratio:Number(a.final_price)/Number(v.fair_value),modelVersion:v.model_version});
    }
    if(!matched.length)return {sample:0,marketFactor:1,meanAbsoluteError:null,matched:[]};
    const ratios=matched.map(x=>x.ratio).sort((a,b)=>a-b);
    const mid=Math.floor(ratios.length/2);
    const median=ratios.length%2?ratios[mid]:(ratios[mid-1]+ratios[mid])/2;
    const mae=matched.reduce((sum,x)=>sum+Math.abs(x.actual-x.predicted),0)/matched.length;
    return {
      sample:matched.length,
      marketFactor:matched.length>=5?Math.max(.65,Math.min(1.5,median)):1,
      observedMedianRatio:Number(median.toFixed(3)),
      meanAbsoluteError:Math.round(mae),
      matched
    };
  }

  async function saveValuationV1({teamId,scoutingPlayerId,fitGrade,scarcityScore,season=55}){
    const context=await contextForScoutingPlayer(scoutingPlayerId,teamId);
    if(!context.profile)throw new Error('Permanent Wildman player identity is not linked yet.');
    const latest=context.seasons.find(x=>x.data_class!=='projection')||context.seasons[0]||null;
    const calibration=await valuationCalibration({season,league:'CHL'});
    const model=valuationV1({position:context.profile.primary_position,seasonRecord:latest,fitGrade,scarcityScore,marketFactor:calibration.marketFactor,calibrationSample:calibration.sample});
    const payload={
      team_id:teamId,player_id:context.profile.id,season,model_version:model.modelVersion,
      fair_value:model.fairValue,expected_market:model.expectedMarket,market_low:model.marketLow,market_high:model.marketHigh,walk_price:model.walkPrice,
      projected_ppg:latest?.ppg??null,performance_score:model.performanceScore,role_scarcity_score:model.roleScarcityScore,
      reliability_score:model.reliabilityScore,team_fit_score:model.teamFitScore,source_confidence:latest?'medium':'low',
      source_kind:'wildman_model',inputs:model.inputs,explanation:{formula:model.formula,calibration:{sample:calibration.sample,marketFactor:calibration.marketFactor,observedMedianRatio:calibration.observedMedianRatio??null,meanAbsoluteError:calibration.meanAbsoluteError}}
    };
    const {data,error}=await db().from('player_valuation_snapshots').insert(payload).select().single();
    if(error)throw error;
    return data;
  }

  function roleCompatibility(posA,posB){
    const a=String(posA||'').toUpperCase(),b=String(posB||'').toUpperCase();
    const ga=positionGroup(a),gb=positionGroup(b);
    if(!a||!b)return 50;
    if((a==='C'&&['LW','RW'].includes(b))||(b==='C'&&['LW','RW'].includes(a)))return 92;
    if((a==='LD'&&b==='RD')||(a==='RD'&&b==='LD'))return 94;
    if(['LW','RW'].includes(a)&&['LW','RW'].includes(b)&&a!==b)return 78;
    if(ga==='F'&&gb==='F')return a===b?55:72;
    if(ga==='D'&&gb==='D')return a===b?58:82;
    if((ga==='F'&&gb==='D')||(ga==='D'&&gb==='F'))return 62;
    if(ga==='G'||gb==='G')return 55;
    return 50;
  }

  function chemistryV1({playerA,playerB,relationship=null,styleScore=null,vodScore=null}={}){
    const role=roleCompatibility(playerA?.primary_position,playerB?.primary_position);
    const sharedGames=Number(relationship?.games_sample||0);
    const histRaw=relationship?.chemistry_score!=null?clamp(relationship.chemistry_score):null;
    const history=histRaw!=null?histRaw:(sharedGames>0?60:null);
    const style=styleScore!=null?clamp(styleScore):null;
    const vod=vodScore!=null?clamp(vodScore):null;
    const pieces=[{name:'role',score:role,weight:60}];
    if(history!=null)pieces.push({name:'history',score:history,weight:25});
    if(style!=null)pieces.push({name:'style',score:style,weight:15});
    if(vod!=null)pieces.push({name:'vod',score:vod,weight:20});
    const total=pieces.reduce((sum,x)=>sum+x.weight,0);
    const overall=pieces.reduce((sum,x)=>sum+x.score*x.weight,0)/total;
    return {
      modelVersion:'chemistry-v1',
      overallScore:Number(overall.toFixed(1)),
      roleCompatibility:role,
      teammateHistoryScore:history,
      styleCompatibility:style,
      vodTendencyScore:vod,
      sharedGames,
      evidenceCount:(history!=null?1:0)+(style!=null?1:0)+(vod!=null?1:0),
      explanation:{
        formula:'Evidence-aware weighted average. Role starts at 60%; historical teammate, style and VOD components join only when evidence exists.',
        role:(playerA?.primary_position||'?')+' + '+(playerB?.primary_position||'?')+' role compatibility = '+role+'/100',
        history:history==null?'No historical teammate evidence yet.':'Historical teammate evidence = '+history+'/100 across '+sharedGames+' shared games.',
        vod:vod==null?'VOD tendencies not scored yet.':'VOD tendency score = '+vod+'/100.'
      }
    };
  }

  async function databaseFirstPlayerSearch(question,{teamId,limit=25}={}){
    const q=String(question||'').trim();
    const pos=(q.match(/\b(LW|RW|LD|RD|C|G)\b/i)||[])[1]?.toUpperCase()||null;
    const budgetMatch=q.match(/(?:under|below|max|less than)\s*\$?\s*(\d+(?:\.\d+)?)\s*m?/i);
    const budget=budgetMatch?Number(budgetMatch[1])*1000000:null;
    const tagMatch=q.match(/[A-Za-z0-9_\-|]{3,}/g)||[];

    // Calgary-first path: when a live/focused market exists, answer from the current
    // team market before falling back to the permanent all-player intelligence catalog.
    if(teamId){
      const focusResp=await db().from('team_scouting_pool')
        .select('scouting_player_id,fit_grade,projected_role,target_bid,max_bid,market_price,market_status,market_source,market_updated_at,market_details,scouting_players(id,gamertag,primary_position,platform)')
        .eq('team_id',teamId).eq('market_focus',true).range(0,999);
      if(!focusResp.error&&(focusResp.data||[]).length){
        const tierWeight={steal:8,strong:7,good:6,fair:5,league_min:5,range:4,prem:3,over:2,walk:1};
        let focus=(focusResp.data||[]).map(r=>{
          const p=r.scouting_players||{},md=r.market_details||{};
          const marketPrice=Number.isFinite(Number(r.market_price))&&Number(r.market_price)>0?Number(r.market_price):null;
          const modelValue=Number.isFinite(Number(md.model_value))&&Number(md.model_value)>0?Number(md.model_value):null;
          const rank=Number.isFinite(Number(md.rank))?Number(md.rank):null;
          const rankPool=Number.isFinite(Number(md.rank_pool))?Number(md.rank_pool):null;
          const rankScore=rank!=null&&rankPool>0?Math.max(0,Math.min(100,(1-(rank-1)/rankPool)*100)):null;
          const fit=Number.isFinite(Number(r.fit_grade))?Math.max(0,Math.min(100,Number(r.fit_grade)*10)):null;
          const tier=String(md.market_tier||'').toLowerCase();
          const sortScore=(tierWeight[tier]||0)*1000+(rankScore||0)*5+(fit||0);
          return {
            profile:{
              id:'scouting:'+r.scouting_player_id,
              gamertag:p.gamertag,
              normalized_gamertag:norm(p.gamertag),
              primary_position:p.primary_position,
              platform:p.platform,
              active:true,
              source_kind:'chelscout_focus'
            },
            valuation:{
              fair_value:modelValue,
              expected_market:marketPrice,
              market_low:null,market_high:null,
              walk_price:r.max_bid!=null?Number(r.max_bid):null,
              performance_score:rankScore,
              reliability_score:null,
              team_fit_score:fit,
              source_kind:'chelscout_focus'
            },
            market:{
              status:r.market_status,
              source:r.market_source,
              updated_at:r.market_updated_at,
              tier:md.market_tier||null,
              server:md.server||null,
              role:md.role||r.projected_role||null,
              reach_pct:md.reach_pct??null,
              confidence:md.confidence||null,
              ppg:md.ppg??null,
              gp:md.gp??null,
              latest_season:md.latest_season??null,
              latest_league:md.latest_league||null,
              projection:md.projection||null,
              rank:md.rank??null,
              rank_pool:md.rank_pool??null,
              rank_group:md.rank_group||null,
              last_price:md.last_price??null,
              model_value:modelValue,
              display_price:marketPrice
            },
            _sortScore:sortScore
          };
        });

        if(pos)focus=focus.filter(x=>String(x.profile.primary_position||'').toUpperCase()===pos);
        if(tagMatch.length&&!pos&&!budget){
          const needles=tagMatch.map(norm).filter(x=>x.length>=3&&!['show','best','find','player','players','market','current','target','targets'].includes(x));
          const exactish=focus.filter(x=>needles.some(n=>x.profile.normalized_gamertag.includes(n)));
          if(exactish.length)focus=exactish;
        }
        if(budget!=null){
          focus=focus.filter(x=>{
            const known=x.valuation.expected_market??x.valuation.fair_value;
            return known!=null&&Number(known)<=budget;
          });
        }
        focus.sort((a,b)=>b._sortScore-a._sortScore||Number(a.valuation.expected_market??1e18)-Number(b.valuation.expected_market??1e18));
        focus=focus.slice(0,limit).map(({_sortScore,...x})=>x);
        return {question:q,recognized:{position:pos,budget,marketFocus:true,marketCount:(focusResp.data||[]).length},results:focus};
      }
    }

    let profileQuery=db().from('player_intelligence_profiles').select('*').eq('active',true).limit(Math.max(limit,100));
    if(pos)profileQuery=profileQuery.eq('primary_position',pos);
    const {data:profiles,error}=await profileQuery;
    if(error)throw error;
    let rows=profiles||[];
    if(tagMatch.length&&!pos&&!budget){
      const needles=tagMatch.map(norm).filter(x=>x.length>=3);
      const exactish=rows.filter(p=>needles.some(n=>p.normalized_gamertag.includes(n)));
      if(exactish.length)rows=exactish;
    }
    const ids=rows.map(x=>x.id);
    let vals=[];
    if(teamId&&ids.length){
      const r=await db().from('player_valuation_snapshots').select('*').eq('team_id',teamId).in('player_id',ids).order('calculated_at',{ascending:false});
      if(r.error)throw r.error;
      const seen=new Set();
      vals=(r.data||[]).filter(v=>!seen.has(v.player_id)&&seen.add(v.player_id));
    }
    const byVal=new Map(vals.map(v=>[v.player_id,v]));
    rows=rows.map(p=>({profile:p,valuation:byVal.get(p.id)||null,market:null}))
      .filter(x=>budget==null||x.valuation?.expected_market==null||Number(x.valuation.expected_market)<=budget)
      .sort((a,b)=>Number(b.valuation?.team_fit_score||0)-Number(a.valuation?.team_fit_score||0)||Number(b.valuation?.performance_score||0)-Number(a.valuation?.performance_score||0))
      .slice(0,limit);
    return {question:q,recognized:{position:pos,budget,marketFocus:false},results:rows};
  }

  window.WildmanPlayerIntelligence={
    normalizeGamertag:norm,
    canonicalByScoutingPlayer,
    contextForScoutingPlayer,
    valuationV1,
    valuationCalibration,
    saveValuationV1,
    roleCompatibility,
    chemistryV1,
    databaseFirstPlayerSearch
  };
})();