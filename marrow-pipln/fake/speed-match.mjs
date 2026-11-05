// Additional synthetic adversary variant. Not imported by the model and not used for calibration.
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,dirname,relative,resolve } from 'node:path';
import { readRecording,extractFeatures } from '../lib/recording.mjs';
import { evaluate,loadProfile } from '../lib/model.mjs';

export function meanMotionSpeed(events) {
  let pending=[],length=0,ms=0;
  for(const e of events) {
    if(e.kind==='pointer')pending.push(e);
    if(e.kind==='click') {
      for(let i=1;i<pending.length;i++)length+=Math.hypot(pending[i].x-pending[i-1].x,pending[i].y-pending[i-1].y);
      if(pending.length>1)ms+=pending.at(-1).t-pending[0].t;
      pending=[];
    }
  }
  return ms>0?length/(ms/1000):0;
}
export function speedMatchedCheck(profilePath,fixturesRoot,primaryReport) {
  const before=loadProfile(profilePath),targetByStyle={};
  for(const style of new Set(primaryReport.rows.map(r=>r.style))) {
    const ownerRows=primaryReport.rows.filter(r=>r.style===style&&r.label==='owner');
    targetByStyle[style]=ownerRows.map(r=>meanMotionSpeed(readRecording(join(fixturesRoot,r.path)))).reduce((a,b)=>a+b,0)/ownerRows.length;
  }
  const rows=[],audit=[];
  for(const r of primaryReport.rows.filter(r=>r.label==='mimic')) {
    const original=readRecording(join(fixturesRoot,r.path)),target=targetByStyle[r.style],oldSpeed=meanMotionSpeed(original),factor=oldSpeed/target;
    const matched=original.map(e=>({...e,t:e.t*factor}));
    const file=join('speed-matched',r.path.split('/').at(-1));mkdirSync(dirname(join(fixturesRoot,file)),{recursive:true});
    writeFileSync(join(fixturesRoot,file),matched.map(e=>JSON.stringify(e)).join('\n')+'\n',{flag:'wx'});
    const a=extractFeatures(original).features,b=extractFeatures(matched).features;
    const maxFeatureDifference=Math.max(...Object.keys(a).map(k=>Math.abs(a[k]-b[k])));
    const sourcePreserved=original.every((e,i)=>e.kind!=='text'||e.source===matched[i].source);
    audit.push({style:r.style,path:file,targetScreenUnitsPerSecond:target,actualScreenUnitsPerSecond:meanMotionSpeed(matched),clockScale:factor,sourcePreserved,maxFeatureDifference});
    rows.push({path:file,label:'mimic',style:r.style});
  }
  const manifestPath=join(fixturesRoot,'test-speed-matched-mimic.json');
  writeFileSync(manifestPath,JSON.stringify({recordings:rows},null,2)+'\n',{flag:'wx'});
  const result=evaluate(profilePath,manifestPath);
  if(loadProfile(profilePath).digest!==before.digest)throw new Error('Profile changed during adversary check');
  const maxSpeedError=Math.max(...audit.map(r=>Math.abs(r.actualScreenUnitsPerSecond-r.targetScreenUnitsPerSecond)));
  if(maxSpeedError>1e-10||audit.some(r=>!r.sourcePreserved||r.maxFeatureDifference>1e-8))throw new Error('Speed matching or feature invariance check failed');
  return {syntheticOnly:true,profileSha256:before.digest,threshold:before.profile.threshold,thresholdUnchanged:true,
    design:'Same 32 held-out mimic trials, with their source/input mode preserved and whole-session clocks rescaled to the observed normal-owner mean pointer speed in each style. No feature, model or threshold change.',
    statisticalLimit:'Derived variants of the main mimic trials, not 32 additional independent observations; do not pool denominators.',
    meanSpeedUnits:'Screen-fraction path length per second of motion (sum of click-delimited pointer paths / sum of their motion durations).',
    targetByStyle,maxAbsoluteSpeedError:maxSpeedError,allSourcesPreserved:true,
    mimicFAR:result.metrics.mimicFAR,byStyle:result.byStyle,rows:result.rows,audit};
}
