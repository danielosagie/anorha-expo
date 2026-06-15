import sys, json, urllib.request
W,H=440.0,956.0
def tree():
    return json.load(urllib.request.urlopen('http://127.0.0.1:3100/ax'))
def walk(n,out):
    f=n.get('frame') or {}
    if n.get('AXLabel'):
        out.append((f.get('x',0),f.get('y',0),f.get('width',0),f.get('height',0),n['AXLabel']))
    for c in n.get('children',[]) or []: walk(c,out)
def main():
    d=tree(); root=d[0] if isinstance(d,list) else d; o=[]; walk(root,o)
    if len(sys.argv)>1:
        q=sys.argv[1].lower()
        for x,y,w,h,l in o:
            if q in l.lower() and 0<=y<=H:
                cx=(x+w/2)/W; cy=(y+h/2)/H
                print(f"{cx:.3f} {cy:.3f}  | {l[:60]}")
                return
        print("NOTFOUND")
    else:
        for x,y,w,h,l in o:
            if 0<=y<=H: print(f"{(x+w/2)/W:.3f} {(y+h/2)/H:.3f}  {l[:55]}")
main()
