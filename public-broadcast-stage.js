(()=>{
'use strict';
const q=new URLSearchParams(location.search);
const requested=String(q.get('channel')||'hitmen-main').toLowerCase();
const allowed=new Set(['hitmen-main','wildman-main']);
const channel=allowed.has(requested)?requested:'hitmen-main';
const stage=document.getElementById('publicBroadcastStage');
const canvas=document.getElementById('publicBroadcastCanvas');
const feed=document.getElementById('publicFeedLayer');
const overlay=document.getElementById('publicOverlayLayer');

function fit(){
  if(!stage||!canvas)return;
  const w=stage.clientWidth||window.innerWidth||1280;
  const h=stage.clientHeight||window.innerHeight||720;
  const scale=Math.min(w/1280,h/720);
  const drawW=1280*scale,drawH=720*scale;
  canvas.style.transform='scale('+scale+')';
  canvas.style.left=Math.max(0,(w-drawW)/2)+'px';
  canvas.style.top=Math.max(0,(h-drawH)/2)+'px';
}

if(feed) feed.src='obs-stage.html?channel='+encodeURIComponent(channel)+'&layer=feed';
if(overlay) overlay.src='obs-overlay.html?channel='+encodeURIComponent(channel);
document.title=(channel==='hitmen-main'?'Calgary Hitmen':'Wildman Hockey')+' Live Broadcast';

fit();
if(window.ResizeObserver&&stage)new ResizeObserver(fit).observe(stage);
else window.addEventListener('resize',fit);
})();