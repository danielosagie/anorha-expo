const [,,xs='0.5',ys='0.5']=process.argv;
const x=parseFloat(xs),y=parseFloat(ys);
const f=(o)=>{const j=Buffer.from(JSON.stringify(o));const b=Buffer.alloc(1+j.length);b[0]=3;j.copy(b,1);return b;};
const s=(ms)=>new Promise(r=>setTimeout(r,ms));
const ws=new WebSocket('ws://127.0.0.1:3100/ws');ws.binaryType='arraybuffer';
ws.onopen=async()=>{ws.send(f({type:'begin',x,y}));await s(40);ws.send(f({type:'end',x,y}));await s(60);ws.close();console.log('tap sent');process.exit(0);};
ws.onerror=(e)=>{console.error('err',e.message||e);process.exit(1);};
