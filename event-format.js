(() => {
  const q = new URLSearchParams(location.search);
  const key = (q.get('format') || '6v6').toLowerCase();
  const formats = {
    '6v6': {
      eyebrow:'TEAM ESPORTS · 6v6',
      title:'6v6<br><span class="wm-green">COMPETITIVE.</span>',
      intro:'Full-team competitive hockey for league play, offseason events and tournament coverage. Rosters, standings, live games, player stats, streams and postgame reports all plug into the existing network.',
      code:'6v6', mode:'Full team competition', status:'ACTIVE', statusText:'Road to Pro infrastructure is already live.',
      heading:'FULL TEAM. FULL BROADCAST.',
      footer:'6v6 · Team rosters · Standings · Live games',
      cards:[
        ['Road to Pro Series','Current tournament center, standings, teams, schedule and player leaderboard.','pro-series.html'],
        ['Live Game Center','Featured streams, live/upcoming games and permanent archives.','game-center.html'],
        ['Player Network','Search rostered players and future event stat lines.','players.html'],
        ['Postgame Reports','Final-score analysis, game recaps and source-backed coverage.','reports.html']
      ]
    },
    '4v4': {
      eyebrow:'OFFSEASON · 4v4',
      title:'4v4<br><span class="wm-green">OFFSEASON.</span>',
      intro:'A faster offseason tournament format designed for compact rosters, quick event nights, streamed series and a clean competitive leaderboard.',
      code:'4v4', mode:'Compact team tournament', status:'READY', statusText:'Format page is live; event data is added when scheduled.',
      heading:'FAST FORMAT. SAME NETWORK.',
      footer:'4v4 · Offseason cups · Streams · Results',
      cards:[
        ['Tournament Board','Use the same central event system for brackets, matchups and schedules.','events.html'],
        ['Live Streams','Feature one game or send viewers to the multistream broadcast wall.','game-center.html'],
        ['Multiview','Watch concurrent 4v4 series from one page.','multiview.html'],
        ['Media + Recaps','Publish clips, finals and postgame stories through Elite Series Media.','wildman-media.html']
      ]
    },
    'hut': {
      eyebrow:'HUT · 1v1',
      title:'HUT<br><span class="wm-green">TOURNAMENTS.</span>',
      intro:'Individual player-vs-player tournaments with bracket-ready event pages, participant profiles, scheduled streams, results and featured media.',
      code:'HUT', mode:'1v1 player competition', status:'READY', statusText:'Platform structure is ready; first event can be added later.',
      heading:'ONE PLAYER. ONE BRACKET.',
      footer:'HUT · 1v1 · Brackets · Player profiles',
      cards:[
        ['Participant Profiles','Players can live in the same searchable network without becoming Wildman roster members.','players.html'],
        ['Live Matches','Scheduled HUT games can publish to Game Center with stream links.','game-center.html'],
        ['Broadcast Wall','Multiple HUT matches can run side-by-side in Multiview.','multiview.html'],
        ['Tournament Stories','Use Elite Series Media for previews, features, recaps and winner coverage.','wildman-media.html']
      ]
    },
    'open': {
      eyebrow:'PLATFORM · FUTURE TITLES',
      title:'MORE<br><span class="wm-green">ESPORTS.</span>',
      intro:'Wildman Hockey remains the flagship, while the network architecture can expand into other game titles without rebuilding the site from scratch.',
      code:'OPEN', mode:'Multi-title platform', status:'FUTURE', statusText:'No additional title has been announced yet.',
      heading:'NOT LOCKED TO ONE GAME.',
      footer:'Future titles · Shared broadcasts · Shared media',
      cards:[
        ['Esports Hub','The central discovery layer for teams, players, events and future games.','esports-hub.html'],
        ['Game Center','A reusable broadcast board for any event with a stream and matchup.','game-center.html'],
        ['Media Network','A reusable editorial and video layer for event coverage.','wildman-media.html'],
        ['Event Formats','Add new verticals alongside 6v6, 4v4 and HUT.','events.html']
      ]
    }
  };
  const f = formats[key] || formats['6v6'];
  document.title = f.code + ' | Wildman Esports Network';
  document.getElementById('formatEyebrow').textContent=f.eyebrow;
  document.getElementById('formatTitle').innerHTML=f.title;
  document.getElementById('formatIntro').textContent=f.intro;
  document.getElementById('formatCode').textContent=f.code;
  document.getElementById('formatMode').textContent=f.mode;
  document.getElementById('formatStatus').textContent=f.status;
  document.getElementById('formatStatusText').textContent=f.statusText;
  document.getElementById('formatHeading').textContent=f.heading;
  document.getElementById('formatFooter').textContent=f.footer;
  document.getElementById('formatCards').innerHTML=f.cards.map((c,i)=>`<a class="ops-card" href="${c[2]}"><small>0${i+1}</small><h3>${c[0]}</h3><p>${c[1]}</p><span class="ops-link">Open →</span></a>`).join('');
})();