(async()=>{
const url=location.origin+'/src/lib/game/systems/particle-system.ts';
const {ParticleSystem}=await import(url);
const lightning={"motionType": 4, "emitsPerSecond": false, "emitsPerMeter": true, "birthrate": 0.05, "maxParticles": 20, "initialParticles": 0, "totalParticles": 0, "totalSeconds": 0, "isPersistent": true, "lifespan": 1, "lifespanRand": 0, "offsetDir": [0, 0, 0], "minOffset": 0.1, "maxOffset": 0.1, "a": [0, 0, 0], "minA": 0.6, "maxA": 1.6, "b": [0, 0, 0], "minB": 0.5, "maxB": 1.5, "c": [0, 20, 0], "minC": 0.8, "maxC": 1.2, "startScale": 0.1, "finalScale": 3.8, "scaleRand": 0.1, "startTrans": 0, "finalTrans": 1, "transRand": 0.25, "followsParent": false, "id": "0x32000195"};
const force={...lightning,id:'0x320001aa',motionType:1,birthrate:0.25,lifespan:1.5,lifespanRand:0.5,isPersistent:false,totalSeconds:10,b:[0,0,1],c:[1,1,1],minC:0.5,maxC:1.5,startScale:1,finalScale:0.1};
const rows=[];
for(const [name,info] of [['lightning',lightning],['force',force]])for(const hz of [30,60,144])for(const multiplier of [1,5,10]){
 let t=0,origin=[0,0,0];const q={w:1,x:0,y:0,z:0};
 const target={generation:1,targetId:'diagnostic-only'};
 const ps=new ParticleSystem({distanceSpacingMultiplier:multiplier,clock:()=>t,sceneOriginOf:()=>origin,targetLives:()=>true,sceneRotationOf:()=>({ac:{columns:[[1,0,0],[0,1,0],[0,0,1]]},render:q}),writeSceneRenderRotationOf:(_,out)=>{Object.assign(out,q);return true;},partFrameOf:()=>target,resolveEmitter:()=>null,roll:()=>0.5});
 ps.create(target,{id:info.id,info,kind:'drawable',mesh:{id:'0x01001732',radius:1},centerReach:10,maximumScale:4},[0,0,0],0,0,origin,target);
 let firstCap=null,lastCount=0,lastBirth=null,maxGap=0;const births=[];const seen=new Set();
 for(let step=1;step<=hz*3;step++){t=step/hz;origin=[15*t,0,0];ps.advance(t);const d=ps.getDiagnostics();for(const range of ps.collectDrawRanges())for(let slot=range.baseSlot;slot<range.baseSlot+range.count;slot++){const at=slot*28;const birth=ps.recordData[at+3];if(!seen.has(birth)){seen.add(birth);births.push({t:birth,x:ps.recordData[at]+ps.recordData[at+21]});if(lastBirth!==null)maxGap=Math.max(maxGap,birth-lastBirth);lastBirth=birth;}}lastCount=d.emittedTotal;if(firstCap===null&&d.particleCount===20)firstCap=t;}
 rows.push({name,hz,multiplier,firstCap,emitted:lastCount,maxGap,births});
}
return rows;
})()
