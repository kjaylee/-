#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generate } from './fake/generate.mjs';
import { speedMatchedCheck } from './fake/speed-match.mjs';
import { train,evaluate,loadProfile,scoreFeatures,sha } from './lib/model.mjs';
import { readRecording,extractFeatures } from './lib/recording.mjs';
import { runContractTests } from './tests.mjs';

function args(values) {
  const result={};for(let i=0;i<values.length;i++) {
    if(!values[i].startsWith('--')||values[i+1]===undefined||values[i+1].startsWith('--'))throw new Error('Flags require values');
    const key=values[i].slice(2);(result[key]??=[]).push(values[++i]);
  }return result;
}
function one(a,k,required=true) {const v=a[k]?.[0];if(required&&!v)throw new Error(`Missing --${k}`);return v;}
function save(path,data) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(data,null,2)+'\n',{flag:'wx'});}
function help() {console.log(`Marrow offline prototype — Node 20+, no packages or network
  node run.mjs demo [--out NEW_DIRECTORY] [--test-seed INTEGER]
  node run.mjs generate --out NEW_DIRECTORY [--test-seed INTEGER]
  node run.mjs train --enroll FILE_OR_DIR [--enroll ...] --calibrate FILE_OR_DIR [--calibrate ...] --out NEW_PROFILE.json
  node run.mjs score --profile PROFILE.json --recording RECORDING.jsonl
  node run.mjs test --profile PROFILE.json --manifest MANIFEST.json --out NEW_REPORT.json
  node tests.mjs
Profile paths need their adjacent .sha256 file. Test manifests contain evaluation labels only.`);}
export function main(argv=process.argv.slice(2)) {
  const command=argv[0]??'help',a=args(argv.slice(1));
  if(command==='help'){help();return;}
  if(command==='generate'){generate(resolve(one(a,'out')),{testSeed:Number(one(a,'test-seed',false)??303)});console.log('Generated fake data only.');return;}
  if(command==='train'){
    const out=resolve(one(a,'out'));mkdirSync(dirname(out),{recursive:true});
    const p=train(a.enroll??[],a.calibrate??[],out);console.log(JSON.stringify({out,threshold:p.threshold,profileSha256:sha(readFileSync(out)),frozen:true}));return;
  }
  if(command==='score'){
    const p=loadProfile(one(a,'profile'));console.log(JSON.stringify({...scoreFeatures(p.profile,extractFeatures(readRecording(one(a,'recording')))),profileSha256:p.digest},null,2));return;
  }
  if(command==='test'){
    const r=evaluate(one(a,'profile'),one(a,'manifest'));save(resolve(one(a,'out')),r);console.log(JSON.stringify(r.metrics,null,2));return;
  }
  if(command!=='demo')throw new Error(`Unknown command ${command}`);
  const seed=Number(one(a,'test-seed',false)??303);if(!Number.isSafeInteger(seed)||seed<0)throw new Error('Test seed must be a nonnegative safe integer');
  const out=one(a,'out',false)?resolve(one(a,'out')):mkdtempSync(join(tmpdir(),'marrow-offline-demo-'));
  mkdirSync(out,{recursive:true});const fixtures=join(out,'fixtures');generate(fixtures,{testSeed:seed});
  const profileA=join(out,'profile-alpha.json'),profileB=join(out,'profile-beta.json');
  train([join(fixtures,'enrollment','alpha')],[join(fixtures,'calibration','alpha')],profileA);
  train([join(fixtures,'enrollment','beta')],[join(fixtures,'calibration','beta')],profileB);
  const contractTests=runContractTests({profilePath:profileA,enrollmentFile:join(fixtures,'enrollment','alpha','mouse-keyboard-0.jsonl')});
  // First held-out evaluation occurs only AFTER both profiles, thresholds and digests are written.
  const primary=evaluate(profileA,join(fixtures,'test-alpha.json'));
  const speedMatchedMimic=speedMatchedCheck(profileA,fixtures,primary);
  const aAsOther=evaluate(profileB,join(fixtures,'swap-alphaToBeta.json'));
  const bAsOther=evaluate(profileA,join(fixtures,'swap-betaToAlpha.json'));
  const swapSummary=r=>({attempts:r.rows.length,opens:r.rows.filter(x=>x.decision==='accept').length,
    rejects:r.rows.filter(x=>x.decision==='reject').length,abstains:r.rows.filter(x=>x.decision==='abstain').length,
    pass:r.rows.every(x=>x.decision!=='accept'),rows:r.rows,profileSha256:r.profileSha256});
  const report={syntheticOnly:true,seeds:{enrollment:101,calibration:202,test:seed},contractTests,
    ...primary,speedMatchedMimic,swaps:{alphaOwnerWithBetaProfile:swapSummary(aAsOther),betaOwnerWithAlphaProfile:swapSummary(bAsOther)},
    importantLimits:['No real human data or accuracy validation.','A toy mimic copies easy first moments but not the full motor trajectory.','Recorded-event replay or an attacker who learns the complete feature distribution can bypass this offline classifier.','Insufficient coverage abstains and counts as owner rejection.','No claim that disabled users, eye gaze, switches or real dictation are validated by these fake styles.']};
  save(join(out,'report.json'),report);
  console.log(JSON.stringify({syntheticOnly:true,out,report:join(out,'report.json'),profileSha256:primary.profileSha256,
    frozenThreshold:primary.threshold,metrics:primary.metrics,byStyle:primary.byStyle,
    speedMatchedMimic:{mimicFAR:speedMatchedMimic.mimicFAR,maxAbsoluteSpeedError:speedMatchedMimic.maxAbsoluteSpeedError,allSourcesPreserved:speedMatchedMimic.allSourcesPreserved,notIndependent:true},
    swaps:Object.fromEntries(Object.entries(report.swaps).map(([k,v])=>[k,{attempts:v.attempts,opens:v.opens,abstains:v.abstains,pass:v.pass}])),contractTests},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(e){console.error(e.message);process.exitCode=1;}
