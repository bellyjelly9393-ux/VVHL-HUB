const assert = require('node:assert/strict');
const test = require('node:test');
const report = require('./video-review-report.js');
const fixture = () => ({id:'job', status:'ready_for_review', result:{
  game_rollup:Object.fromEntries(report.sections.map(([k]) => [k, 'Evidence-backed ' + k])),
  chunks:[{label:'P1',start:0,end:120,frame_step_seconds:6,
    review:{summary:'Overview',observations:[],uncertainties:['Identity uncertain']}}]}});
test('partial or failed analysis cannot import as a complete report', () => {
  const job=fixture(); job.status='processing';
  assert.equal(report.complete(job),false);
  assert.throws(()=>report.reportText(job));
  job.status='ready_for_review'; job.result.game_rollup.player_report='';
  assert.equal(report.complete(job),false);
});
test('full import retains all report sections and real coverage', () => {
  const text=report.reportText(fixture());
  for(const [key] of report.sections)assert.ok(text.includes('Evidence-backed '+key));
  assert.ok(text.includes('6 seconds')); assert.ok(text.includes('Identity uncertain'));
});
test('reimport replaces its own section and preserves surrounding edits', () => {
  const once=report.replaceBlock('Coach introduction','job','first');
  const twice=report.replaceBlock(once+'\nCoach conclusion','job','finished');
  assert.ok(twice.includes('Coach introduction')); assert.ok(twice.includes('Coach conclusion'));
  assert.ok(!twice.includes('first')); assert.equal(twice.split('[Video review job]').length,2);
  assert.equal(report.replaceBlock(twice,'job','finished'),twice);
});
test('Twitch mobile link and trimmed-recording offset point to the right evidence', () => {
  assert.equal(report.replayLink('https://www.twitch.tv/aichelmachine/v/2876177579?sr=a',30,600),
    'https://www.twitch.tv/videos/2876177579?t=630s');
  assert.equal(report.replayLink('javascript:alert(1)',0),'');
});
