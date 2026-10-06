/* Wildman / EliteChel OBS scene registry.
   Add new scene presets here. Studio buttons and overlay behavior infer from this registry. */
(function(){
  'use strict';

  var scenes=[
    {
      id:'game-matchup',
      scene:'game',
      label:'Gameplay',
      sublabel:'Matchup Panel',
      template:'game',
      preset:{
        feedLayout:'panel',
        sidePanel:'matchup',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'auto',
        logoPreset:'ea',
        logoSize:48,
        streamMuted:false
      }
    },
    {
      id:'game-standings',
      scene:'game',
      label:'Gameplay',
      sublabel:'Standings',
      template:'game',
      preset:{
        feedLayout:'panel',
        sidePanel:'league',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'auto',
        logoPreset:'ea',
        logoSize:48,
        streamMuted:false
      }
    },
    {
      id:'game-streamer',
      scene:'game',
      label:'Gameplay',
      sublabel:'Streamer',
      template:'game',
      preset:{
        feedLayout:'panel',
        sidePanel:'socials',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'auto',
        logoPreset:'ea',
        logoSize:48,
        streamMuted:false
      }
    },
    {
      id:'game-clean',
      scene:'game',
      label:'Gameplay',
      sublabel:'Full Game',
      template:'game',
      preset:{
        feedLayout:'full',
        sidePanel:'brand',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'auto',
        logoPreset:'ea',
        logoSize:48,
        streamMuted:false
      }
    },
    {
      id:'starting',
      scene:'starting',
      label:'Starting Soon',
      sublabel:'Full Screen',
      template:'full',
      preset:{
        feedLayout:'full',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'off',
        streamMuted:true
      }
    },
    {
      id:'intermission',
      scene:'intermission',
      label:'Intermission',
      sublabel:'Big Scoreboard',
      template:'break',
      preset:{
        feedLayout:'full',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'off',
        streamMuted:true
      }
    },
    {
      id:'final',
      scene:'final',
      label:'Final',
      sublabel:'Postgame',
      template:'break',
      preset:{
        feedLayout:'full',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'off',
        streamMuted:true
      }
    },
    {
      id:'player',
      scene:'player',
      label:'Player ID',
      sublabel:'Lower Third',
      template:'player',
      preset:{
        feedLayout:'panel',
        sidePanel:'matchup',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'auto',
        logoPreset:'ea',
        logoSize:48,
        streamMuted:false
      }
    },
    {
      id:'brb',
      scene:'brb',
      label:'BRB',
      sublabel:'Full Screen',
      template:'full',
      preset:{
        feedLayout:'full',
        bugPosition:'hidden',
        showScoreboard:false,
        logoBug:'off',
        streamMuted:true
      }
    }
  ];

  function get(id){
    return scenes.find(function(item){return item.id===id;})||scenes[0];
  }

  function infer(scene,payload){
    var p=payload||{};

    if(p.presetId){
      var exact=scenes.find(function(item){return item.id===p.presetId;});
      if(exact)return exact;
    }

    if(scene==='game'){
      if(p.feedLayout==='full')return get('game-clean');
      if(p.sidePanel==='league')return get('game-standings');
      if(p.sidePanel==='socials')return get('game-streamer');
      return get('game-matchup');
    }

    return scenes.find(function(item){return item.scene===scene;})||get('game-matchup');
  }

  window.WM_OBS_SCENES={
    all:scenes,
    get:get,
    infer:infer,
    label:function(scene,payload){return infer(scene,payload).label;}
  };
})();