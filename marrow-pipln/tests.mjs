import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,copyFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseRecording,extractFeatures } from './lib/recording.mjs';
import { loadProfile,evaluate,modelInputHash } from './lib/model.mjs';

function sample() {
  const a=[];for(let s=0;s<10;s++) {
    for(let j=0;j<=12;j++)a.push({t:s*3000+j*60,kind:'pointer',x:.2+j*.03,y:.3+Math.sin(j/12*Math.PI)*.06});
    a.push({t:s*3000+800,kind:'click',x:.56,y:.3,button:'primary'});
    for(let j=0;j<3;j++)a.push({t:s*3000+1000+j*100,kind:'text',op:j===1?'delete':'insert',source:'typed',length:1});
  }return a;
}
const encode=es=>es.map(e=>JSON.stringify(e)).join('\n');
export function runContractTests({profilePath,enrollmentFile}={}) {
  let count=0;const check=(name,fn)=>{fn();count++;};const input=sample(),events=parseRecording(encode(input));
  check('unknown identity/style fields refused',()=>assert.throws(()=>parseRecording(encode([{...input[0],identity:'alpha'}]))));
  check('nonmonotone timestamps refused',()=>assert.throws(()=>parseRecording(encode([input[1],input[0]]))));
  check('coordinates bounded',()=>assert.throws(()=>parseRecording(encode([{...input[0],x:1.2}]))));
  check('text source contract',()=>assert.throws(()=>parseRecording(encode([{t:0,kind:'text',op:'insert',source:'dictation',length:1}]))));
  check('unknown field refused',()=>assert.throws(()=>parseRecording(encode([{...input[0],device:'mouse'}]))));
  check('sufficient ordinary sequence',()=>assert.equal(extractFeatures(events).sufficient,true));
  check('input-source does not identify user',()=>assert.deepEqual(extractFeatures(events),extractFeatures(parseRecording(encode(input.map(e=>e.kind==='text'?{...e,source:'software'}:e))))));
  check('actual text discarded',()=>{
    const a=parseRecording(encode(input.map(e=>e.kind==='text'?{...e,text:'a'}:e)));
    const b=parseRecording(encode(input.map(e=>e.kind==='text'?{...e,text:'z'}:e)));
    assert.deepEqual(a,b);assert.deepEqual(extractFeatures(a),extractFeatures(b));
  });
  check('global fatigue time scaling invariant',()=>{
    const a=extractFeatures(events).features,b=extractFeatures(parseRecording(encode(input.map(e=>({...e,t:e.t*2.5}))))).features;
    for(const k of Object.keys(a))assert.ok(Math.abs(a[k]-b[k])<1e-9,`${k} changed under global speed scaling`);
  });
  check('insufficient evidence abstains',()=>assert.equal(extractFeatures(events.slice(0,20)).sufficient,false));
  check('canonical inputs ignore serialization/source/text/offset/scale',()=>{
    const altered=parseRecording(input.map(e=>JSON.stringify(e.kind==='text'?{length:e.length,text:'z',source:'software',op:e.op,kind:e.kind,t:100+e.t*2}:{y:e.y,x:e.x,kind:e.kind,t:100+e.t*2,...(e.kind==='click'?{button:'secondary'}:{})})).join('\r\n'));
    assert.equal(modelInputHash(events),modelInputHash(altered));
  });
  if(profilePath&&enrollmentFile) {
    const temporary=mkdtempSync(join(tmpdir(),'marrow-contract-'));
    check('frozen profile mutation refused',()=>{
      const p=join(temporary,'mutated.json');copyFileSync(profilePath,p);copyFileSync(profilePath+'.sha256',p+'.sha256');
      writeFileSync(p,readFileSync(p,'utf8')+' ');assert.throws(()=>loadProfile(p),/digest mismatch/);
    });
    check('train-test content leakage refused',()=>{
      const p=join(temporary,'leak.json');writeFileSync(p,JSON.stringify({recordings:[{path:resolve(enrollmentFile),label:'stranger',style:'misleading-label'}]}));
      assert.throws(()=>evaluate(profilePath,p),/leakage/);
    });
    check('cosmetic training leakage refused',()=>{
      const original=parseRecording(readFileSync(enrollmentFile,'utf8'));
      const altered=original.map(e=>e.kind==='text'?{...e,source:'onscreen',t:e.t+500}:{...e,t:e.t+500});
      const recording=join(temporary,'cosmetic.jsonl');writeFileSync(recording,encode(altered));
      const manifest=join(temporary,'cosmetic-manifest.json');writeFileSync(manifest,JSON.stringify({recordings:[{path:recording,label:'owner'}]}));
      assert.throws(()=>evaluate(profilePath,manifest),/canonical model-input leakage/);
    });
    check('held-out denominator duplication refused',()=>{
      const recording=join(temporary,'unique.jsonl');writeFileSync(recording,encode(sample()));
      const manifest=join(temporary,'duplicate-manifest.json');writeFileSync(manifest,JSON.stringify({recordings:[{path:recording,label:'owner'},{path:recording,label:'stranger'}]}));
      assert.throws(()=>evaluate(profilePath,manifest),/Duplicate held-out/);
    });
  }
  return {passed:count,failed:0,scope:'Input validation, source/content noninterference, fatigue time invariance, abstention, and (in demo) frozen-profile/held-out content leakage.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(runContractTests()));
