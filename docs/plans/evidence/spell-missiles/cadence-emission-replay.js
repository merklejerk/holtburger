(async()=>{
const {ParticleSystem}=await import(location.origin+"/src/lib/game/systems/particle-system.ts");
const inputs=[{"name": "lightning-default", "speed": 15, "info": {"birthrate": 0.05, "maxParticles": 20.0, "initialParticles": 0.0, "totalParticles": 0.0, "totalSeconds": 0.0, "lifespan": 1.0, "lifespanRand": 0.0, "minOffset": 0.1, "maxOffset": 0.1, "minA": 0.6, "maxA": 1.6, "minB": 0.5, "maxB": 1.5, "minC": 0.8, "maxC": 1.2, "startScale": 0.1, "finalScale": 2.0, "scaleRand": 1.1, "startTrans": 0.0, "finalTrans": 1.0, "transRand": 0.25, "id": "0x3200012d", "emitsPerSecond": false, "emitsPerMeter": true, "motionType": 4, "offsetDir": [0.0, 0.0, 0.0], "a": [0.0, 0.0, 0.0], "b": [0.0, 0.0, 0.0], "c": [0.0, 20.0, 0.0], "isPersistent": true, "followsParent": true}}, {"name": "lightning-v", "speed": 15, "info": {"birthrate": 0.05, "maxParticles": 20.0, "initialParticles": 0.0, "totalParticles": 0.0, "totalSeconds": 0.0, "lifespan": 1.0, "lifespanRand": 0.0, "minOffset": 0.1, "maxOffset": 0.1, "minA": 0.6, "maxA": 1.6, "minB": 0.5, "maxB": 1.5, "minC": 0.8, "maxC": 1.2, "startScale": 0.1, "finalScale": 3.8, "scaleRand": 0.1, "startTrans": 0.0, "finalTrans": 1.0, "transRand": 0.25, "id": "0x32000195", "emitsPerSecond": false, "emitsPerMeter": true, "motionType": 4, "offsetDir": [0.0, 0.0, 0.0], "a": [0.0, 0.0, 0.0], "b": [0.0, 0.0, 0.0], "c": [0.0, 20.0, 0.0], "isPersistent": true, "followsParent": false}}, {"name": "force-v", "speed": 15, "info": {"birthrate": 0.25, "maxParticles": 20.0, "initialParticles": 0.0, "totalParticles": 0.0, "totalSeconds": 10.0, "lifespan": 1.5, "lifespanRand": 0.5, "minOffset": 0.1, "maxOffset": 0.1, "minA": 0.6, "maxA": 1.6, "minB": 0.5, "maxB": 1.5, "minC": 0.5, "maxC": 1.5, "startScale": 1.0, "finalScale": 0.1, "scaleRand": 0.1, "startTrans": 0.0, "finalTrans": 1.0, "transRand": 0.25, "id": "0x320001aa", "emitsPerSecond": false, "emitsPerMeter": true, "motionType": 1, "offsetDir": [0.0, 0.0, 0.0], "a": [0.0, 0.0, 0.0], "b": [0.0, 0.0, 1.0], "c": [1.0, 1.0, 1.0], "isPersistent": false, "followsParent": false}}, {"name": "tectonic-rifts", "speed": 2, "info": {"birthrate": 0.0566667, "maxParticles": 10.0, "initialParticles": 0.0, "totalParticles": 0.0, "totalSeconds": 1.5, "lifespan": 0.4, "lifespanRand": 0.1, "minOffset": 0.0, "maxOffset": 0.0, "minA": 0.9, "maxA": 1.0, "minB": 0.5, "maxB": 1.5, "minC": 0.5, "maxC": 1.2, "startScale": 3.0, "finalScale": 0.1, "scaleRand": 0.01, "startTrans": 1.0, "finalTrans": 0.0, "transRand": 0.0, "id": "0x320004d1", "emitsPerSecond": false, "emitsPerMeter": true, "motionType": 9, "offsetDir": [0.0, 0.0, 1.0], "a": [0.0, 6.0, 0.0], "b": [0.0, 0.0, 0.0], "c": [0.0, 0.0, 0.0], "isPersistent": false, "followsParent": true}}];
const results=[];
for(const {name,speed,info} of inputs)for(const fps of [15,30,60,144])for(const multiplier of [1,3,13]) {
 let t=0,origin=[0,0,0];const q={w:1,x:0,y:0,z:0};const target={generation:1,targetId:'isolated-cadence-replay'};
 const ps=new ParticleSystem({distanceSpacingMultiplier:multiplier,clock:()=>t,sceneOriginOf:()=>origin,targetLives:()=>true,sceneRotationOf:()=>({ac:{columns:[[1,0,0],[0,1,0],[0,0,1]]},render:q}),writeSceneRenderRotationOf:(_,out)=>{Object.assign(out,q);return true;},partFrameOf:()=>target,resolveEmitter:()=>null,roll:()=>0.5});
 ps.create(target,{id:info.id,info,kind:'drawable',mesh:{id:'0x01001732',radius:1},centerReach:10,maximumScale:4},[0,0,0],0,0,origin,target);
 const births=[],seen=new Set();let firstCap=null;
 for(let step=1;step<=fps*3;step++) {
  t=step/fps;origin=[speed*t,0,0];ps.advance(t);
  if(firstCap===null&&ps.getDiagnostics().particleCount===info.maxParticles)firstCap=t;
  for(const range of ps.collectDrawRanges())for(let slot=range.baseSlot;slot<range.baseSlot+range.count;slot++) {
   const at=slot*28,birth=ps.recordData[at+3];if(!seen.has(birth)){seen.add(birth);births.push({t:birth,x:info.followsParent?null:ps.recordData[at]+ps.recordData[at+21]});}
  }
 }
 results.push({name,speed,fps,multiplier,emitted:ps.getDiagnostics().emittedTotal,firstCap,maxBirthGap:Math.max(0,...births.slice(1).map((b,i)=>b.t-births[i].t)),births});
}
for(const {name} of inputs)for(const multiplier of [1,3,13]) {
 const group=results.filter(r=>r.name===name&&r.multiplier===multiplier),baseline=JSON.stringify(group[0].births);
 for(const row of group)if(JSON.stringify(row.births)!==baseline)throw new Error('Frame-rate mismatch '+name+' '+multiplier+' '+row.fps);
}
return results;
})()
