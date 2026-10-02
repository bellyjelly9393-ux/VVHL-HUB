const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const pages=['index.html','wildman-room.html','hitmen-room.html','lg-network.html','tournaments.html','competition.html','academy.html','elite-chel-media.html','media-story.html'];
for(const file of ['network-shell.js','public-network-config.js','public-network-model.js','public-network.js','esports-network.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
for(const file of pages){
 const html=fs.readFileSync(file,'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);if(new Set(ids).size!==ids.length)throw Error(file+': duplicate IDs');
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const value=match[1];if(/^(https?:|#)/.test(value))continue;
  const target=value.split(/[?#]/)[0];if(!fs.existsSync(path.resolve(target)))throw Error(file+': missing local target '+target);
 }
 for(const required of ['<title>','name="description"','property="og:title"','name="viewport"'])if(!html.includes(required))throw Error(file+': missing metadata '+required);
}
for(const file of ['index.html','academy.html'])if(/\$\d|Meet the Core|meet-core/i.test(fs.readFileSync(file,'utf8')))throw Error(file+': removed launch content returned');
JSON.parse(fs.readFileSync('vercel.json','utf8'));
console.log('Week 2 changed JavaScript, page targets, IDs, metadata and content checks passed.');
