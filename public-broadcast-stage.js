(()=>{
'use strict';
const q=new URLSearchParams(location.search);
const requested=String(q.get('channel')||'hitmen-main').toLowerCase();
const allowed=new Set(['hitmen-main','wildman-main']);
const channel=allowed.has(requested)?requested:'hitmen-main';
const feed=document.getElementById('publicFeedLayer');
const overlay=document.getElementById('publicOverlayLayer');
if(feed) feed.src='obs-stage.html?channel='+encodeURIComponent(channel)+'&layer=feed';
if(overlay) overlay.src='obs-overlay.html?channel='+encodeURIComponent(channel);
document.title=(channel==='hitmen-main'?'Calgary Hitmen':'Wildman Hockey')+' Live Broadcast';
})();