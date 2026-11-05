import sys,subprocess
stage,verify,release=sys.argv[1:4]
h=subprocess.check_output(['git','log','-1','--format=%h'],cwd='/root/worktrees/aims-batch1-simplify').decode().strip()
p='/root/worktrees/aims-batch1-simplify/.agent-handoffs/実装進捗-バッチ1.md'
s=open(p).read()
row=f"| {stage} | コミット済み | {h} | {verify} | {release} |\n"
k=s.index("\n## 補足")
# insert before blank line preceding 補足
head=s[:k].rstrip("\n")+"\n"
s=head+row+s[k:]
s=s.replace("# 実装進捗-バッチ1(段階01〜16)","# 実装進捗-バッチ1(段階01〜26。17〜19は別途)")
open(p,'w').write(s)
