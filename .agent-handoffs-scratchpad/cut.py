import sys
def cut_test(path, title, indent=2):
    """title を含む it / it.each ブロックを削除。インデントは先頭 it の空白数。"""
    s=open(path).read()
    assert s.count(title)==1,(path,title,s.count(title))
    t=s.index(title)
    pad=' '*indent
    # start: the nearest preceding line that begins with pad+"it(" or pad+"it.each("
    cand=[s.rfind(pad+'it(\n',0,t),s.rfind(pad+'it("',0,t),s.rfind(pad+'it.each(',0,t),s.rfind(pad+'describe.each(',0,t)]
    start=max(c for c in cand)
    assert start>=0
    # end: first line after t that equals pad+"});" or pad+");"
    i=t
    while True:
        j=s.index('\n',i)+1
        line=s[j:s.index('\n',j)]
        if line in (pad+'});',pad+');'):
            end=s.index('\n',j)+1
            break
        i=j
    if s[end:end+1]=='\n': end+=1
    removed=s[start:end]
    s=s[:start]+s[end:]
    open(path,'w').write(s)
    return removed
if __name__=='__main__':
    cut_test(sys.argv[1],sys.argv[2],int(sys.argv[3]) if len(sys.argv)>3 else 2)
