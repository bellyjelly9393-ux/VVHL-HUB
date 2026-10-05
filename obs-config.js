/* Broadcast Studio / OBS config: the one place to change default stream feeds and Twitch embed hosts.
   Loaded by obs-control.html (Broadcast Studio) and obs-stage.html (OBS Stage / Feed Layer). */
(function(){
  'use strict';
  window.WM_OBS_CONFIG={
    // Default gameplay feed per studio channel. Used when the channel has no feed attached yet, and
    // prefilled into the Studio's Stream URL field. A feed attached in the Studio always wins.
    defaultFeeds:{
      'hitmen-main':'https://www.twitch.tv/ctbli'
    },
    // Twitch only plays inside pages whose host is listed in the embed's parent= params.
    // The current host is added at runtime too, so Vercel preview URLs and localhost also work.
    twitchParents:['wildmanhockey-elitechelmedia.app','www.wildmanhockey-elitechelmedia.app']
  };
  window.WM_OBS_CONFIG.defaultFeedFor=function(channel){
    return window.WM_OBS_CONFIG.defaultFeeds[String(channel||'')]||'';
  };
  window.WM_OBS_CONFIG.twitchParentList=function(){
    var list=window.WM_OBS_CONFIG.twitchParents.slice();
    var host=String(location.hostname||'').toLowerCase();
    if(host&&list.indexOf(host)<0)list.push(host);
    return list;
  };
})();
