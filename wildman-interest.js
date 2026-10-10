(()=>{'use strict';
const $=id=>document.getElementById(id),form=$('interestForm'),msg=$('interestMessage');
const client=window.supabase?.createClient('https://lrgllzvwgvqagcpiyvfd.supabase.co','sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP');
if(!form||!client)return;
const program=$('interestProgram');const q=new URLSearchParams(location.search).get('program');if(['franchise','hut'].includes(q))program.value=q;
document.querySelectorAll('[data-interest-program]').forEach(a=>a.addEventListener('click',()=>{program.value=a.dataset.interestProgram;}));
function message(t,error){msg.textContent=t;msg.style.color=error?'#ffc4bd':'#dcd19a';}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!form.reportValidity())return;
 const data=new FormData(form);if(data.get('website')){message('Thank you.');return;}
 const btn=$('interestSubmit');btn.disabled=true;btn.textContent='Submitting…';
 const values={program:program.value,gamertag:String(data.get('gamertag')||'').trim(),email:String(data.get('email')||'').trim().toLowerCase(),discord_handle:String(data.get('discord_handle')||'').trim(),platform:String(data.get('platform')),division:String(data.get('division')||'unsure'),notes:String(data.get('notes')||'').trim()||null,contact_consent:data.get('contact_consent')==='on'};
 try {
   const r=await client.from('wildman_program_interest').insert(values);
   if(r.error){if(r.error.code==='23505')throw new Error('That email is already on this program interest list.');throw new Error('Unable to save your interest right now. Please try again.');}
   form.reset();program.value=values.program;message('Interest submitted. Wildman organizers can review it in their management dashboard.');
 }catch(err){message(err.message||'Unable to submit. Please retry.',true);}
 finally{btn.disabled=false;btn.textContent='Submit Interest';}
});
})();