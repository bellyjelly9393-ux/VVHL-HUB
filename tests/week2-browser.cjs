const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const pages=['index.html','wildman-room.html','hitmen-room.html','lg-network.html','tournaments.html','competition.html','academy.html','elite-chel-media.html','media-story.html'];
(async()=>{
 const browser=await chromium.launch();fs.mkdirSync('qa-artifacts',{recursive:true});const errors=[];
 try{
  for(const width of [360,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900}});
   for(const file of pages){
    const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto('http://127.0.0.1:8080/'+file,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.WildmanPublicUI?.loaded);
    await page.waitForFunction(()=>window.WildmanEsportsNetwork?.loaded,{timeout:45000});
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.wn-network-header .main-nav a').count(),8,file+': navigation');
    assert.ok(await page.locator('.wn-score-track a').count()>0,file+': ticker fallback');
    const invented=await page.locator('a[href$="/undefined"],a[href$="/null"],img[src$="/undefined"],img[src$="/null"]').count();
    assert.equal(invented,0,file+': invented URL from missing data');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,file+' at '+width+': page-wide overflow');
    const toggle=page.locator('.menu-toggle');
    if(await toggle.isVisible()){
     await toggle.click();await page.locator('.main-nav.open').waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
     await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    }
    errors.push(...pageErrors.map(e=>file+': '+e));
    if([390,1440].includes(width))await page.screenshot({path:'qa-artifacts/'+file.replace('.html','')+'-'+width+'.png',fullPage:true});
    if(file==='index.html'&&[390,1440].includes(width)){
     const review=await page.screenshot({type:'jpeg',quality:45,fullPage:true});
     console.log('WEEK2_IMAGE '+width+' '+review.toString('base64'));
    }
    await page.close();
   }
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}});
  for(const file of ['team.html','game-center.html','hitmen-media.html','hitmen-workspace.html']){
   const page=await context.newPage();await page.goto('http://127.0.0.1:8080/'+file,{waitUntil:'domcontentloaded'});
   if(file==='hitmen-workspace.html'){
    await page.waitForTimeout(1000);
    const exposed=await page.locator('[data-management-content]').evaluateAll(els=>els.some(el=>!el.hidden));
    assert.equal(exposed,false,'anonymous management content exposed');
   }
   await page.close();
  }
  await context.close();assert.deepEqual(errors,[],'JavaScript page errors');
  console.log('Mobile and desktop public routes, ticker, menu, overflow, legacy route load and anonymous management guard passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
