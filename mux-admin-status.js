(() => {
  async function checkMux() {
    const badge=document.getElementById('muxConnectionBadge');
    const api=document.getElementById('muxApiState');
    const apiNote=document.getElementById('muxApiNote');
    const creds=document.getElementById('muxCredentialState');
    const webhook=document.getElementById('muxWebhookState');
    const webhookNote=document.getElementById('muxWebhookNote');
    const message=document.getElementById('muxConnectionMessage');
    if(!badge||!api||!creds||!webhook) return;

    try {
      const res=await fetch('/api/mux-health',{cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      creds.textContent=data.configured?'READY':'MISSING';
      api.textContent=data.connected?'CONNECTED':data.configured?'ERROR':'NOT SET';
      webhook.textContent=data.webhookSecretConfigured?'READY':'NOT SET';

      badge.textContent=data.connected?'MUX CONNECTED':'MUX NEEDS ATTENTION';
      apiNote.textContent=data.connected
        ? 'Vercel can authenticate to the Mux Video API.'
        : data.configured
          ? 'Credentials exist, but Mux authentication did not succeed.'
          : 'Mux credentials are not available to this deployment.';
      webhookNote.textContent=data.webhookSecretConfigured
        ? 'Webhook signature verification can be enabled safely.'
        : 'Add MUX_WEBHOOK_SECRET before relying on webhook-driven asset updates.';

      message.textContent=data.connected
        ? (data.webhookSecretConfigured
            ? 'Mux is authenticated and webhook signing is configured. The remaining work is wiring Mux asset IDs/playback into the VOD workflow.'
            : 'Mux API credentials are working. The webhook signing secret is the remaining infrastructure item before full production event syncing.')
        : 'Mux is not fully connected to this deployment yet. No existing VOD/Railway functionality has been changed.';
    } catch (error) {
      badge.textContent='MUX CHECK FAILED';
      api.textContent='UNKNOWN';
      creds.textContent='UNKNOWN';
      webhook.textContent='UNKNOWN';
      if(message) message.textContent='Could not reach the Mux health endpoint. Existing video tools are still untouched.';
    }
  }

  window.addEventListener('vvhl-auth-change',()=>setTimeout(checkMux,100));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',checkMux,{once:true});
  else checkMux();
})();