import { readFileSync } from 'node:fs';

export function parseRecording(text) {
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Recording exceeds 32 MiB');
  const events = []; let previous = -1;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { throw new Error(`Line ${i + 1}: invalid JSON`); }
    if (!e || Array.isArray(e) || typeof e !== 'object') throw new Error(`Line ${i + 1}: expected event object`);
    const allowed = e.kind === 'pointer' ? ['t','kind','x','y'] : e.kind === 'click' ? ['t','kind','x','y','button'] : e.kind === 'text' ? ['t','kind','op','source','length','text'] : [];
    if (!allowed.length || Object.keys(e).some(k => !allowed.includes(k))) throw new Error(`Line ${i + 1}: unknown event kind or field`);
    if (!Number.isFinite(e.t) || e.t < 0 || e.t < previous) throw new Error(`Line ${i + 1}: timestamps must be nonnegative monotone milliseconds`);
    previous = e.t;
    if (e.kind === 'pointer' || e.kind === 'click') {
      if (![e.x,e.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error(`Line ${i + 1}: x/y must be in [0,1]`);
      if (e.kind === 'click' && !['primary','secondary','auxiliary'].includes(e.button)) throw new Error(`Line ${i + 1}: invalid button`);
      events.push({t:e.t,kind:e.kind,x:e.x,y:e.y,...(e.kind === 'click' ? {button:e.button} : {})});
    } else {
      if (!['insert','delete'].includes(e.op) || !['typed','onscreen','software'].includes(e.source)) throw new Error(`Line ${i + 1}: invalid text operation/source`);
      if (!Number.isSafeInteger(e.length) || e.length < 1 || e.length > 4096) throw new Error(`Line ${i + 1}: length must be integer 1..4096`);
      if (e.text !== undefined && (typeof e.text !== 'string' || [...e.text].length !== e.length || e.text.length > 8192)) throw new Error(`Line ${i + 1}: optional text must match length`);
      // Drop actual text at the parser boundary. Source is preserved for interoperability, never used by features.
      events.push({t:e.t,kind:'text',op:e.op,source:e.source,length:e.length});
    }
    if (events.length > 200000) throw new Error('Too many events');
  }
  return events;
}
export function readRecording(path) { return parseRecording(readFileSync(path,'utf8')); }
export function quantile(a, q) {
  if (!a.length) return 0;
  const b = [...a].sort((x,y)=>x-y), p = (b.length-1)*q, lo = Math.floor(p);
  return b[lo] + (b[Math.ceil(p)]-b[lo])*(p-lo);
}
const med = a => quantile(a,.5);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

function strokeFeatures(points, click) {
  const compact = points.filter((p,i)=>!i || distance(p,points[i-1]) > 1e-6);
  if (compact.length < 6) return null;
  const cumulative=[0]; for(let i=1;i<compact.length;i++) cumulative.push(cumulative.at(-1)+distance(compact[i-1],compact[i]));
  const length=cumulative.at(-1), start=compact[0], end=compact.at(-1), direct=distance(start,end), duration=end.t-start.t;
  if (direct < .025 || length < .025 || duration <= 0) return null;
  // Fixed arc-length resampling removes event-rate and sample-count as direct features.
  const sampled=[]; let j=1;
  for(let k=0;k<17;k++) {
    const target=length*k/16; while(j<compact.length-1 && cumulative[j]<target) j++;
    const f=(target-cumulative[j-1])/(cumulative[j]-cumulative[j-1]);
    const a=compact[j-1],b=compact[j]; sampled.push({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t:a.t+(b.t-a.t)*f});
  }
  const ux=(end.x-start.x)/direct,uy=(end.y-start.y)/direct;
  const lateral=sampled.map(p=>Math.abs((p.x-start.x)*uy-(p.y-start.y)*ux)/direct);
  const projection=sampled.map(p=>((p.x-start.x)*ux+(p.y-start.y)*uy)/direct);
  let turns=0;
  for(let i=1;i<sampled.length-1;i++) {
    const a=sampled[i-1],b=sampled[i],c=sampled[i+1];
    const vx=b.x-a.x,vy=b.y-a.y,wx=c.x-b.x,wy=c.y-b.y;
    turns+=Math.abs(Math.atan2(vx*wy-vy*wx,vx*wx+vy*wy));
  }
  return {efficiency:direct/length,lateral:Math.max(...lateral),turns:turns/Math.PI,
    t25:(sampled[4].t-start.t)/duration,t50:(sampled[8].t-start.t)/duration,t75:(sampled[12].t-start.t)/duration,
    overshoot:Math.max(0,Math.max(...projection)-1,-Math.min(...projection)),
    clickLag:Math.max(0,click.t-end.t)/duration,duration};
}

export const FEATURE_NAMES = ['efficiency','lateral','turns','t25','t50','t75','overshoot','clickLag',
  'durationIqrRatio','efficiencyIqr','lateralIqr','deleteFraction','deleteInsertIntervalRatio','textIntervalIqrRatio'];
export function extractFeatures(events) {
  let pending=[]; const strokes=[];
  for(const e of events) {
    if(e.kind==='pointer') pending.push(e);
    if(e.kind==='click') { const s=strokeFeatures(pending,e); if(s) strokes.push(s); pending=[]; }
  }
  const text=events.filter(e=>e.kind==='text');
  const quality={events:events.length,pointerEvents:events.filter(e=>e.kind==='pointer').length,validStrokes:strokes.length,textEvents:text.length};
  if (strokes.length < 8 || quality.pointerEvents < 64 || text.length < 20) return {sufficient:false,reason:'insufficient_coverage',quality};
  const features={};
  for(const name of ['efficiency','lateral','turns','t25','t50','t75','overshoot','clickLag']) features[name]=med(strokes.map(s=>s[name]));
  const iqr=a=>quantile(a,.75)-quantile(a,.25);
  features.durationIqrRatio=iqr(strokes.map(s=>s.duration))/Math.max(1,med(strokes.map(s=>s.duration)));
  features.efficiencyIqr=iqr(strokes.map(s=>s.efficiency)); features.lateralIqr=iqr(strokes.map(s=>s.lateral));
  let insert=0,del=0; const intervals=[],insIntervals=[],delIntervals=[];
  for(let i=0;i<text.length;i++) {
    const e=text[i]; if(e.op==='insert') insert+=e.length; else del+=e.length;
    if(i && e.t>text[i-1].t) {const dt=e.t-text[i-1].t; intervals.push(dt); (e.op==='insert'?insIntervals:delIntervals).push(dt);}
  }
  features.deleteFraction=del/Math.max(1,insert);
  features.deleteInsertIntervalRatio=delIntervals.length ? med(delIntervals)/Math.max(1,med(insIntervals)) : 1;
  features.textIntervalIqrRatio=iqr(intervals)/Math.max(1,med(intervals));
  if(!FEATURE_NAMES.every(n=>Number.isFinite(features[n]))) return {sufficient:false,reason:'nonfinite_features',quality};
  return {sufficient:true,features,quality};
}
