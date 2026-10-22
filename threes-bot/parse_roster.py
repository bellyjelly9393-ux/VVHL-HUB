import re,json,sys,html
s=open(sys.argv[1],errors='ignore').read()
out=[]
parts=re.split(r'id="team_roster_(\d+)"',s)
for k in range(1,len(parts),2):
  tid=int(parts[k]); body=parts[k+1].split('id="team_roster_')[0]
  for m in re.finditer(r'image_leader_lb[^>]*>([A-Za-z ]+)</div><div class="image_leader_roster"><a href="[^"]*userid=(\d+)',body):
    out.append({"lg_user_id":int(m[2]),"gamertag":None,"lg_team_id":tid,"position":None,"role":m[1].strip()})
  for m in re.finditer(r'class="navLink lgleague[^"]*"[^>]*userid=(\d+)[^>]*>([^<]+)</a>(?:\s*<span class="badge[^"]*">[^<]*</span>)*\s*<span class="muted">([A-Z]+)',body):
    out.append({"lg_user_id":int(m[1]),"gamertag":html.unescape(m[2]).strip(),"lg_team_id":tid,"position":m[3],"role":"Player"})
by={}
for o in out:
  b=by.setdefault(o['lg_user_id'],dict(o))
  if o['role']!='Player': b['role']=o['role'] if b['role']=='Player' else b['role']
  if o['gamertag']: b['gamertag']=o['gamertag']; b['position']=o['position']
out=list(by.values())
json.dump(out,open(sys.argv[2],'w'))
print(len(out),"players",len({o['lg_team_id'] for o in out}),"teams", len({o['lg_user_id'] for o in out}),"unique")
