// Human-cadence drag over serve-sim WS (0x03 JSON channel — confirmed format).
// Usage: node drag.mjs <x> <yStart> <yEnd> [gapMs] [steps] [holdMs]
const [, , xs='0.5', y0s='0.72', y1s='0.18', gapS='35', stepS='12', holdS='90'] = process.argv;
const x=parseFloat(xs), y0=parseFloat(y0s), y1=parseFloat(y1s);
const GAP=parseInt(gapS), STEPS=parseInt(stepS), HOLD=parseInt(holdS);
const f=(o)=>{const j=Buffer.from(JSON.stringify(o));const b=Buffer.alloc(1+j.length);b[0]=3;j.copy(b,1);return b;};
const s=(ms)=>new Promise(r=>setTimeout(r,ms));
const ws=new WebSocket('ws://127.0.0.1:3100/ws'); ws.binaryType='arraybuffer';
ws.onopen=async()=>{
  ws.send(f({type:'begin',x,y:y0})); await s(HOLD); // touch-down, settle
  for(let i=1;i<=STEPS;i++){ const y=y0+(y1-y0)*(i/STEPS); ws.send(f({type:'move',x,y})); await s(GAP); }
  ws.send(f({type:'move',x,y:y1})); await s(GAP); // final move to settle position
  ws.send(f({type:'end',x,y:y1})); await s(120);
  ws.close(); console.log(`drag x=${x} ${y0}->${y1} gap=${GAP} steps=${STEPS}`); process.exit(0);
};
ws.onerror=(e)=>{console.error('ws error',e.message||e);process.exit(1);};
