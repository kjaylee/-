import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readRecording, extractFeatures, FEATURE_NAMES, quantile } from './recording.mjs';
export const sha = b => createHash('sha256').update(b).digest('hex');
export function modelInputHash(events) {
  const start=events[0]?.t??0,span=Math.max(1,(events.at(-1)?.t??start)-start);
  const number=n=>Number(n.toFixed(10));
  // Canonical model inputs: no JSON formatting, key order, ignored source/text/button, or time offset/scale.
  return sha(JSON.stringify(events.map(e=>e.kind==='text'?
    {t:number((e.t-start)/span),kind:e.kind,op:e.op,length:e.length}:
    {t:number((e.t-start)/span),kind:e.kind,x:number(e.x),y:number(e.y)})));
}
export function recordings(paths) {
  return paths.flatMap(p=>statSync(p).isDirectory()?readdirSync(p).sort().flatMap(n=>recordings([join(p,n)])):p.endsWith('.jsonl')?[resolve(p)]:[]);
}
export function scoreFeatures(profile, extracted) {
  if(!extracted.sufficient) return {decision:'abstain',reason:extracted.reason,score:null,quality:extracted.quality};
  const z=FEATURE_NAMES.map(n=>(extracted.features[n]-profile.center[n])/profile.scale[n]);
  const score=Math.sqrt(z.reduce((s,v)=>s+Math.min(v*v,100),0)/z.length);
  return {decision:score<=profile.threshold?'accept':'reject',reason:score<=profile.threshold?'within_frozen_threshold':'outside_frozen_threshold',score,quality:extracted.quality};
}
export function train(enrollment,calibration,out) {
  if(existsSync(out)) throw new Error('Refusing to overwrite a frozen profile; choose a new output file');
  const eFiles=recordings(enrollment),cFiles=recordings(calibration);
  if(eFiles.length<6 || cFiles.length<6) throw new Error('Need at least six separate enrollment and six separate calibration recordings');
  const eHashes=eFiles.map(p=>sha(readFileSync(p))),cHashes=cFiles.map(p=>sha(readFileSync(p)));
  if(new Set([...eHashes,...cHashes]).size!==eFiles.length+cFiles.length) throw new Error('Duplicate recording content across enrollment/calibration');
  const eEvents=eFiles.map(readRecording),cEvents=cFiles.map(readRecording);
  const canonicalHashes=[...eEvents,...cEvents].map(modelInputHash);
  if(new Set(canonicalHashes).size!==canonicalHashes.length)throw new Error('Duplicate canonical model inputs in enrollment/calibration');
  const e=eEvents.map(extractFeatures),c=cEvents.map(extractFeatures);
  if([...e,...c].some(x=>!x.sufficient)) throw new Error('Insufficient enrollment/calibration recording; inspect coverage requirements');
  const center={},scale={};
  // Fixed floors and threshold rule are specified before held-out testing; no impostor labels enter training.
  for(const n of FEATURE_NAMES) {
    const values=e.map(x=>x.features[n]);center[n]=quantile(values,.5);
    const floor=['turns','deleteInsertIntervalRatio','textIntervalIqrRatio'].includes(n)?.08:.025;
    scale[n]=Math.max(floor,1.4826*quantile(values.map(v=>Math.abs(v-center[n])),.5));
  }
  const profile={schema:'marrow-profile-1',featureVersion:1,featureNames:FEATURE_NAMES,center,scale,threshold:Infinity};
  const calibrationScores=c.map(x=>scoreFeatures(profile,x).score);
  profile.threshold=quantile(calibrationScores,.95)*1.10+.05;
  if(!Number.isFinite(profile.threshold)||profile.threshold>=10)throw new Error('Uninformative calibration: threshold reaches capped score maximum; no profile frozen');
  profile.calibrationRule='Owner-only calibration q95(distance) * 1.10 + 0.05; constants fixed before test';
  profile.enrollmentCount=e.length;profile.calibrationCount=c.length;
  profile.trainingRecordingSha256=[...eHashes,...cHashes];
  profile.trainingModelInputSha256=canonicalHashes;
  profile.enrollmentFeatureSha256=e.map(x=>sha(JSON.stringify(x.features)));
  profile.calibrationScores=calibrationScores;
  const bytes=JSON.stringify(profile,null,2)+'\n';writeFileSync(out,bytes,{flag:'wx'});
  writeFileSync(out+'.sha256',sha(bytes)+'\n',{flag:'wx'});
  return profile;
}
export function loadProfile(path) {
  const bytes=readFileSync(path),digest=sha(bytes),expected=readFileSync(path+'.sha256','utf8').trim();
  if(digest!==expected) throw new Error('Frozen profile digest mismatch');
  const p=JSON.parse(bytes);
  if(p.schema!=='marrow-profile-1'||p.featureVersion!==1||JSON.stringify(p.featureNames)!==JSON.stringify(FEATURE_NAMES)||!Number.isFinite(p.threshold)||p.threshold<=0||p.threshold>=10||!Array.isArray(p.trainingModelInputSha256)) throw new Error('Unsupported/invalid profile');
  for(const n of FEATURE_NAMES) if(!Number.isFinite(p.center[n])||!Number.isFinite(p.scale[n])||p.scale[n]<=0)throw new Error('Invalid profile geometry');
  return {profile:p,digest};
}
export function wilson(success,n) {
  if(!n)return {low:null,high:null};const z=1.959963984540054,p=success/n,d=1+z*z/n;
  const mid=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return {low:Math.max(0,mid-half),high:Math.min(1,mid+half)};
}
export function rate(rows,positive) {const k=rows.filter(positive).length,n=rows.length;return {numerator:k,denominator:n,rate:n?k/n:null,wilson95:wilson(k,n)};}
export function evaluate(profilePath,manifestPath) {
  const before=loadProfile(profilePath),m=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(!Array.isArray(m.recordings))throw new Error('Manifest must contain recordings array');
  const seen=new Set();
  const rows=m.recordings.map(r=>{
    if(!['owner','tired-owner','stranger','mimic'].includes(r.label)||typeof r.path!=='string')throw new Error('Invalid evaluation label/path');
    const path=resolve(dirname(manifestPath),r.path),bytes=readFileSync(path),digest=sha(bytes);
    if(before.profile.trainingRecordingSha256.includes(digest))throw new Error('Held-out/training content leakage detected');
    const events=readRecording(path),canonicalHash=modelInputHash(events);
    if(before.profile.trainingModelInputSha256.includes(canonicalHash))throw new Error('Held-out/training canonical model-input leakage detected');
    if(seen.has(canonicalHash))throw new Error('Duplicate held-out canonical model inputs; denominator inflation refused');
    seen.add(canonicalHash);
    const extracted=extractFeatures(events);
    // Label and style only decorate the result AFTER the score has been calculated.
    const result=scoreFeatures(before.profile,extracted);
    return {path:r.path,label:r.label,style:r.style??'unspecified',recordingSha256:digest,modelInputSha256:canonicalHash,...result};
  });
  const metricsFor=rs=>({
    strangerFAR:rate(rs.filter(r=>r.label==='stranger'),r=>r.decision==='accept'),
    ownerFRR:rate(rs.filter(r=>r.label==='owner'),r=>r.decision!=='accept'),
    tiredOwnerFRR:rate(rs.filter(r=>r.label==='tired-owner'),r=>r.decision!=='accept'),
    mimicFAR:rate(rs.filter(r=>r.label==='mimic'),r=>r.decision==='accept'),
    abstentions:rs.filter(r=>r.decision==='abstain').length
  });
  if(loadProfile(profilePath).digest!==before.digest)throw new Error('Profile changed during test');
  return {schema:'marrow-report-1',profileSha256:before.digest,threshold:before.profile.threshold,thresholdUnchanged:true,
    abstentionPolicy:'Abstain counts as rejection, including in owner/tired FRR.',metrics:metricsFor(rows),
    byStyle:Object.fromEntries([...new Set(rows.map(r=>r.style))].map(s=>[s,metricsFor(rows.filter(r=>r.style===s))])),rows,
    uncertainty:'Wilson intervals describe these finite synthetic trials only; not real people, devices, independent operators, or deployment accuracy.'};
}
