# -*- coding: utf-8 -*-
import re,sys,os,json
from collections import defaultdict
sys.path.insert(0,'.')
import sc,scn
ROOT='/home/user/aims'
md=open(ROOT+'/.agent-handoffs/処理分割.md',encoding='utf-8').read()
sec=md.split('## 3. 処理ごとの対象ファイル')[1].split('## 4.')[0]
tiles=defaultdict(list); pname={}; ptiles=defaultdict(list)
cur=None
for l in sec.split('\n'):
    m=re.match(r'### ([A-Z]+-\d+) (.*)',l)
    if m: cur=m.group(1); pname[cur]=m.group(2); continue
    m=re.match(r'- `([^`]+)` \((.*)\)',l)
    if m and cur:
        path,spec=m.groups()
        n=int(re.search(r'1-(\d+)\)?$',spec.split(' / ')[0]).group(1)) if spec.startswith('全体') else None
        if spec.startswith('全体'): rs=[(1,n)]
        else: rs=[tuple(map(int,p.split('-'))) for p in spec.split(' / ')[0].split(',')]
        tiles[path].append((cur,rs)); ptiles[cur].append((path,rs))
targets=sorted(tiles)
def nl(p):
    d=open(ROOT+'/'+p,encoding='utf-8').read(); return d.count('\n')+(0 if d.endswith('\n') or not d else 1)
def find(suf):
    c=[p for p in targets if p.endswith(suf)]
    if len(c)!=1: raise SystemExit(f'ambiguous/none {suf}: {c}')
    return c[0]
def expand(tok):
    out=[]
    if tok.startswith('@'):
        t=tok[1:]; sub=None
        if '~' in t: t,sub=t.split('~',1)
        if t not in ptiles: raise SystemExit('no proc '+t)
        for path,rs in ptiles[t]:
            if sub is None or sub in path:
                for a,b in rs: out.append((path,a,b))
        if not out: raise SystemExit('empty '+tok)
    elif tok in sc.SEG:
        for f,rs in sc.SEG[tok]:
            p=find(f)
            for a,b in (rs or [(1,nl(p))]): out.append((p,a,b))
    else: raise SystemExit('unknown token '+tok)
    return out
cov=defaultdict(set); scen_ranges={}
tokuse=defaultdict(list)
for S in scn.SC:
    rs=[]
    for tok in S['segs']:
        e=expand(tok); rs+=e; tokuse[tok].append(S['id'])
    scen_ranges[S['id']]=rs
    for p,a,b in rs:
        n=nl(p)
        if b>n: b=n
        cov[p].update(range(a,b+1))
# 未カバー
unc={}
tot=0; covd=0
for p in targets:
    n=nl(p); tot+=n
    c={i for i in cov[p] if 1<=i<=n}; covd+=len(c)
    miss=[i for i in range(1,n+1) if i not in c]
    if miss:
        rr=[]; 
        for i in miss:
            if rr and rr[-1][1]==i-1: rr[-1][1]=i
            else: rr.append([i,i])
        unc[p]=rr
def comp(lines):
    out=[]
    for i in sorted(lines):
        if out and out[-1][1]==i-1: out[-1][1]=i
        else: out.append([i,i])
    return ",".join(f"{a}-{b}" if a!=b else f"{a}" for a,b in out)
json.dump(dict(unc=unc,tot=tot,covd=covd,nfiles=len(targets)),open('cov.json','w'),ensure_ascii=False)
print('files',len(targets),'lines',tot,'covered',covd,'uncovered files',len(unc))
for p,r in unc.items(): print(p,sum(b-a+1 for a,b in r),r[:6])
