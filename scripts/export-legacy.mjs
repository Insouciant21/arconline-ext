import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { query } from './lib/cloudflare.mjs';
const {values}=parseArgs({options:{out:{type:'string',default:'.migration/cloud-export'}}});
await mkdir(path.join(values.out,'snapshots'),{recursive:true});
const save=(name,value)=>writeFile(path.join(values.out,name),JSON.stringify(value,null,2)+'\n');
const snapshots=(await query('SELECT body FROM snapshots ORDER BY fetched_at,id')).map(row=>JSON.parse(row.body));
await save('b50-history.json',snapshots);await save('latest.json',snapshots.at(-1)||null);
for(const snapshot of snapshots) await save(`snapshots/${snapshot.id}.json`,snapshot);
const points=await query('SELECT local_date AS date,fetched_at AS fetchedAt,potential,snapshot_id AS snapshotId,source FROM ptt_points');
await save('official-ptt-history.json',points.filter(point=>point.source==='lowiro'));
const byDate=new Map();for(const point of points){const old=byDate.get(point.date);if(!old||point.potential>old.potential||point.potential===old.potential&&point.fetchedAt>old.fetchedAt)byDate.set(point.date,point);}
const daily=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));await save('ptt-history.json',daily);
const cache=await query('SELECT kind,key,body FROM cache');
for(const [kind,name] of [['chart','chart-images.json'],['character','character-images.json'],['alias','chart-aliases.json']]){
 const entries=cache.filter(row=>row.kind===kind).map(row=>[row.key,JSON.parse(row.body)]);
 const map={};for(const [key,value] of entries)map[kind==='chart'?value.songId:kind==='character'?String(value.characterId):key]=value;
 await save(name,map);
}
await save('logs.json',(await query('SELECT body FROM logs ORDER BY timestamp DESC LIMIT 500')).map(row=>JSON.parse(row.body)));
const csv=value=>{const text=String(value);return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
await writeFile(path.join(values.out,'b50-history.csv'),['snapshot_id,fetched_at,trigger,potential,weighted_potential,rank,song_id,difficulty,rating,score,clear_type',...snapshots.flatMap(s=>s.best50.map((score,i)=>[s.id,s.fetchedAt,s.trigger,s.potential,s.weightedPotential,i+1,score.songId,score.difficulty,score.rating,score.score,score.clearType].map(csv).join(',')))].join('\n')+'\n');
await writeFile(path.join(values.out,'ptt-history.csv'),['date,potential,snapshot_id,fetched_at',...daily.map(p=>[p.date,p.potential,p.snapshotId,p.fetchedAt].map(csv).join(','))].join('\n')+'\n');
console.log(JSON.stringify({directory:values.out,snapshots:snapshots.length,points:points.length}));
