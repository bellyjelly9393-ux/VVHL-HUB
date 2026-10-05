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
    // Player streams for the Studio's "Player Stream" dropdown. Add new season streams here
    // (label = what the Studio shows, url = Twitch/YouTube link). First entry is the usual pick.
    // label = player name · channel. Channel names are handles only, never on-screen branding
    // (the brand is always EliteChel Series Media).
    playerStreams:[
      {player:'ctbli',label:'ctbli · ctbli',url:'https://www.twitch.tv/ctbli'},
      {player:'Setty',label:'Setty (GM) · aichelmachine',url:'https://www.twitch.tv/aichelmachine'},
      {player:'Henny',label:'Henny · talladega_tom',url:'https://www.twitch.tv/talladega_tom'},
      {player:'imona_plain',label:'imona_plain (owner) · imona_plain',url:'https://www.twitch.tv/imona_plain'}
    ],
    // Side panel "Socials" preset. Leave discord empty to hide that row.
    socials:{
      discord:'',
      followText:'Follow the stream'
    },
    // Twitch only plays inside pages whose host is listed in the embed's parent= params.
    // The current host is added at runtime too, so Vercel preview URLs and localhost also work.
    twitchParents:['wildmanhockey-elitechelmedia.app','www.wildmanhockey-elitechelmedia.app']
  };
  window.WM_OBS_CONFIG.defaultFeedFor=function(channel){
    return window.WM_OBS_CONFIG.defaultFeeds[String(channel||'')]||'';
  };
  window.WM_OBS_CONFIG.playerForUrl=function(url){
    var key=String(url||'').toLowerCase().replace(/\/+$/,'').replace('://twitch.tv','://www.twitch.tv');
    return (window.WM_OBS_CONFIG.playerStreams||[]).find(function(s){return String(s.url).toLowerCase()===key;})||null;
  };
  window.WM_OBS_CONFIG.twitchParentList=function(){
    var list=window.WM_OBS_CONFIG.twitchParents.slice();
    var host=String(location.hostname||'').toLowerCase();
    if(host&&list.indexOf(host)<0)list.push(host);
    return list;
  };
})();
