# Independent (different technique: flat text + regex over row HTML) extraction of every player line, for cross-checking.
import re, json, html as H
out=[]
for gid in range(921533, 921551):
    s=open(f'/workspace/lg3s-audit/raw/lg_game_{gid}.html', encoding='utf-8').read()
    for m in re.finditer(r'<tr[^>]*>((?:(?!</tr>).)*?team/p16/team(\d+)\.png(?:(?!</tr>).)*?page=team_user&userid=(\d+)&leagueid=154&seasonid=1">[^<]*</a>\s*\((\w+)\)(?:(?!</tr>).)*)</tr>', s, re.S):
        row, team, uid, pos = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
        tail = row.split('</a>',2)[-1]
        nums = [H.unescape(re.sub(r'<[^>]+>','',c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', tail, re.S)]
        if pos == 'G':
            sa, svp, ga, sv = nums[0], nums[1], nums[2], nums[3]
            out.append(dict(gid=gid, uid=uid, k='goalie', t=team, sa=int(sa), ga=int(ga), sv=int(sv)))
        else:
            out.append(dict(gid=gid, uid=uid, k='skater', t=team, g=int(nums[0]), a=int(nums[1]), p=int(nums[2])))
print(json.dumps(out))
