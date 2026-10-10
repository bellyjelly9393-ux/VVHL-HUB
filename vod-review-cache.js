// Shared, bandwidth-friendly loader for a VOD review and its segments/markers/publication.
// A review row with its worker output is ~500 KB and its segments/markers add another
// ~250 KB, so the page must not re-download them on every poll. Each poll first reads a
// tiny fingerprint (timestamps, statuses, counts) and only re-fetches the full bundle when
// something actually changed. Any write this page makes to these tables clears the cache,
// and a cached copy is never reused for more than MAX_AGE, so edits always show up.
(function(){
  if(window.WildmanVODCache)return;
  const MAX_AGE=10*60*1000;
  const WATCHED=new Set(['vod_review_sessions','vod_review_segments','vod_review_markers','vod_game_publications']);
  const cache=new Map();    // reviewId -> {key, bundle, at}
  const inflight=new Map(); // reviewId -> Promise (dedupes the several page scripts polling at once)
  const clear=()=>cache.clear();

  // Clear the cache whenever page code writes to a VOD table (when the write starts and
  // again when it finishes), so a save is never hidden behind a stale cached copy.
  function watchWrites(client){
    if(!client||client.__vodCacheWatched)return;
    const from=client.from.bind(client);
    client.from=table=>{
      const builder=from(table);
      if(!WATCHED.has(table))return builder;
      for(const m of ['insert','update','upsert','delete']){
        const orig=builder[m]?.bind(builder);if(!orig)continue;
        builder[m]=(...args)=>{
          clear();
          const q=orig(...args),then=q.then.bind(q);
          q.then=(ok,bad)=>then(v=>{clear();return v;},e=>{clear();throw e;}).then(ok,bad);
          return q;
        };
      }
      return builder;
    };
    client.__vodCacheWatched=true;
  }
  const db=()=>{const c=window.VVHLBackend?.db;watchWrites(c);return c;};

  async function fingerprint(id){
    const [r,s,m,p]=await Promise.all([
      db().from('vod_review_sessions').select('updated_at,status,worker_status,worker_updated_at').eq('id',id).maybeSingle(),
      db().from('vod_review_segments').select('id,status,updated_at,archived_at').eq('review_id',id),
      db().from('vod_review_markers').select('id',{count:'exact',head:true}).eq('review_id',id),
      db().from('vod_game_publications').select('active,published_at').eq('review_id',id).maybeSingle()
    ]);
    for(const x of [r,s,m,p])if(x.error)throw x.error;
    if(!r.data)return null;
    return JSON.stringify([r.data,(s.data||[]).sort((a,b)=>String(a.id).localeCompare(String(b.id))),m.count,p.data]);
  }

  async function full(id){
    const [r,s,m,p]=await Promise.all([
      db().from('vod_review_sessions').select('*').eq('id',id).maybeSingle(),
      db().from('vod_review_segments').select('*').eq('review_id',id).order('start_seconds'),
      db().from('vod_review_markers').select('*').eq('review_id',id).order('timestamp_seconds'),
      db().from('vod_game_publications').select('active,report,published_at').eq('review_id',id).maybeSingle()
    ]);
    for(const x of [r,s,m,p])if(x.error)throw x.error;
    return {review:r.data,segments:s.data||[],markers:m.data||[],publication:p.data};
  }

  // Returns {review, segments, markers, publication}; review is null when the row is gone.
  // force:true skips the fingerprint check (use right before acting on exact data).
  function bundle(id,{force=false}={}){
    if(!id||!db())return Promise.resolve(null);
    const running=inflight.get(id);
    if(running&&!force)return running;
    const job=(async()=>{
      const key=force?null:await fingerprint(id);
      const hit=cache.get(id);
      if(!force&&key===null){cache.delete(id);return {review:null,segments:[],markers:[],publication:null};}
      if(!force&&hit&&hit.key===key&&Date.now()-hit.at<MAX_AGE)return hit.bundle;
      const data=await full(id);
      // After a forced load, store a fresh fingerprint so the next poll can reuse it.
      cache.set(id,{key:force?await fingerprint(id):key,bundle:data,at:Date.now()});
      return data;
    })().finally(()=>{if(inflight.get(id)===job)inflight.delete(id);});
    inflight.set(id,job);
    return job;
  }

  window.WildmanVODCache={
    bundle,
    review:async(id,opts)=>(await bundle(id,opts))?.review||null,
    invalidate:id=>{if(id)cache.delete(id);else cache.clear();}
  };
})();
