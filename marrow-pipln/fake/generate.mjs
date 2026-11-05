// Synthetic fixture generator ONLY. Never imported by feature extraction or training.
import { mkdirSync,writeFileSync } from 'node:fs';
import { join,relative } from 'node:path';
export function rng(seed) {let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const motor={alpha:{bend:.20,gamma:.68,overshoot:.12,wiggle:.012,lag:.08,correction:.18},beta:{bend:.035,gamma:1.58,overshoot:.008,wiggle:.007,lag:.24,correction:.09},mimic:{bend:.115,gamma:1.18,overshoot:.055,wiggle:.010,lag:.08,correction:.18}};
function session(style,who,tired,random) {
  const p=motor[who],assisted=style==='slow-dictation',source=assisted?'software':'typed';
  const meanDuration=assisted?2500:850,slow=tired?1.4+random()*.65:1;
  // Mimic copies owner's input source, mean motion duration, idle/click delay and correction frequency.
  // It only partially imitates latent trajectory/easing. This is NOT a strong replay-resistant adversary.
  let t=0,events=[];const strokeCount=18;
  const durations=Array.from({length:strokeCount},()=>.90+random()*.20),norm=durations.reduce((a,b)=>a+b,0)/strokeCount;
  const bend=p.bend+(random()-.5)*.018,gamma=p.gamma+(random()-.5)*.055;
  for(let s=0;s<strokeCount;s++) {
    const duration=meanDuration*slow*durations[s]/norm;
    t+=duration*(.10+random()*.035);
    const x0=.20+random()*.18,y0=.20+random()*.55,dx=.28+random()*.22,dy=(random()-.5)*.28,d=Math.hypot(dx,dy),ux=-dy/d,uy=dx/d;
    const steps=12+Math.floor(random()*12);
    for(let i=0;i<=steps;i++) {
      const u=i/steps,v=Math.pow(u,gamma);
      const progress=v+p.overshoot*Math.sin(Math.PI*v)*Math.pow(v,3)*5;
      const lateral=bend*Math.sin(Math.PI*v)+p.wiggle*Math.sin(4*Math.PI*v)*(1-v);
      events.push({t:Math.round(t+duration*u),kind:'pointer',x:x0+dx*progress+ux*d*lateral,y:y0+dy*progress+uy*d*lateral});
    }
    t+=duration;t+=duration*(p.lag+(random()-.5)*.015);
    events.push({t:Math.round(t),kind:'click',x:x0+dx,y:y0+dy,button:'primary'});
    for(let j=0;j<4;j++) {
      t+=slow*(assisted?440:125)*(.85+random()*.3);
      events.push({t:Math.round(t),kind:'text',op:'insert',source,length:assisted?12+Math.floor(random()*13):1});
      if(random()<p.correction*(tired?1.2:1)) {
        t+=slow*(assisted?260:80)*(.85+random()*.3);
        events.push({t:Math.round(t),kind:'text',op:'delete',source,length:assisted?2+Math.floor(random()*4):1});
        t+=slow*(assisted?300:110)*(.85+random()*.3);
        events.push({t:Math.round(t),kind:'text',op:'insert',source,length:assisted?3+Math.floor(random()*4):1});
      }
    }
  }
  return events;
}
function save(path,events) {mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n')+'\n',{flag:'wx'});}
export function generate(root,{enrollmentSeed=101,calibrationSeed=202,testSeed=303}={}) {
  const styles=['mouse-keyboard','slow-dictation'];mkdirSync(root,{recursive:true});
  const manifests={alpha:[],beta:[]};
  for(const phase of ['enrollment','calibration'])for(const who of ['alpha','beta'])for(const style of styles) {
    const random=rng((phase==='enrollment'?enrollmentSeed:calibrationSeed)+(who==='alpha'?0:4000)+(style===styles[0]?0:8000));
    for(let i=0;i<(phase==='enrollment'?8:6);i++)save(join(root,phase,who,`${style}-${i}.jsonl`),session(style,who,phase==='calibration'&&i%3===0,random));
  }
  for(const owner of ['alpha','beta'])for(const style of styles)for(const label of ['owner','tired-owner','stranger','mimic']) {
    const random=rng(testSeed+(owner==='alpha'?0:15000)+(style===styles[0]?0:30000)+['owner','tired-owner','stranger','mimic'].indexOf(label)*60000);
    for(let i=0;i<16;i++) {
      const who=label==='stranger'?(owner==='alpha'?'beta':'alpha'):label==='mimic'?'mimic':owner;
      // The synthetic mimic targets alpha. Beta report's mimic lane is not used as a claim of beta imitation.
      const file=join('test',owner,`${style}-${label}-${i}.jsonl`);
      save(join(root,file),session(style,who,label==='tired-owner',random));
      manifests[owner].push({path:file,label,style});
    }
  }
  for(const owner of ['alpha','beta'])writeFileSync(join(root,`test-${owner}.json`),JSON.stringify({recordings:manifests[owner]},null,2)+'\n',{flag:'wx'});
  const swaps={alphaToBeta:manifests.alpha.filter(r=>['owner','tired-owner'].includes(r.label)),betaToAlpha:manifests.beta.filter(r=>['owner','tired-owner'].includes(r.label))};
  for(const[name,rows]of Object.entries(swaps))writeFileSync(join(root,`swap-${name}.json`),JSON.stringify({recordings:rows},null,2)+'\n',{flag:'wx'});
  writeFileSync(join(root,'generator-audit.json'),JSON.stringify({syntheticOnly:true,enrollmentSeed,calibrationSeed,testSeed,styles,profileOwners:['alpha','beta'],mimicTarget:'alpha',mimicCopies:['input source/mode','mean motion duration','click/idle timing mean','correction probability'],mimicDoesNotCopy:['full trajectory shape','within-motion easing'],warning:'These invented separable motor families are a software test, not evidence of human authentication performance.'},null,2)+'\n',{flag:'wx'});
  return manifests;
}
