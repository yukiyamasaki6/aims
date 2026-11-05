import re,sys
def remove_block(path, title_prefix, start_token='it'):
    s=open(path).read()
    lines=s.split('\n')
    idx=[i for i,l in enumerate(lines) if l.lstrip().startswith(f'{start_token}("{title_prefix}') or l.lstrip().startswith(f'{start_token}(\n') and False]
    if not idx:
        idx=[i for i,l in enumerate(lines) if title_prefix in l and re.match(rf'\s*{start_token}(\.each|\()',l)]
    assert len(idx)==1,(path,title_prefix,idx)
    i=idx[0]
    indent=len(lines[i])-len(lines[i].lstrip())
    # for it.each( [...] )(...) the end is a line `indent+");"` or `indent+"});"`
    j=i
    while True:
        j+=1
        l=lines[j]
        if len(l)-len(l.lstrip())==indent and l.strip() in ('});',');'):
            break
    end=j+1
    # remove trailing blank line
    if end<len(lines) and lines[end].strip()=='' :
        end+=1
    elif i>0 and lines[i-1].strip()=='':
        i-=1
    del lines[i:end]
    open(path,'w').write('\n'.join(lines))
    print('removed',path,title_prefix[:30],i,end)
if __name__=='__main__':
    remove_block(sys.argv[1],sys.argv[2],*(sys.argv[3:4]))
