import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { query } from './lib/cloudflare.mjs';
import { readLegacy, mergeLegacy, fingerprint, localDate, hash } from './lib/legacy.mjs';

const { values } = parseArgs({ options: { data: { type:'string', multiple:true }, r2:{type:'boolean'}, apply:{type:'boolean'}, verify:{type:'boolean'}, report:{type:'string',default:'.migration/import-report.json'}, sql:{type:'string'} } });
const sources = [];
for (const directory of values.data || ['data']) sources.push({ name:directory, data:await readLegacy(directory) });
const remoteIds = new Set();
if (values.r2) {
  for (const key of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) if (!process.env[key]) throw new Error(`Missing ${key}`);
  const client = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY} });
  const bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
  const snapshots=[];
  let cursor;
  do {
    const list = await client.send(new ListObjectsV2Command({ Bucket:bucket,Prefix:'snapshots/',ContinuationToken:cursor }));
    for (const object of list.Contents || []) if (object.Key.endsWith('.json')) {
      const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:object.Key}));
      const snapshot=JSON.parse(await result.Body.transformToString()); snapshots.push(snapshot); remoteIds.add(snapshot.id);
    }
    cursor=list.IsTruncated?list.NextContinuationToken:undefined;
  } while(cursor);
  sources.unshift({name:'R2',data:{snapshots,points:[],charts:{},characters:{},aliases:{},logs:[]}});
}
// A repeated live import must not roll newer cloud data back to an older source.
if (values.apply || values.verify) {
  const rows=await query('SELECT body FROM snapshots');
  const points=await query('SELECT local_date AS date,fetched_at AS fetchedAt,potential,snapshot_id AS snapshotId,source FROM ptt_points');
  const caches=await query('SELECT kind,key,body FROM cache');
  const data={snapshots:rows.map(row=>JSON.parse(row.body)),points,charts:{},characters:{},aliases:{},logs:(await query('SELECT body FROM logs')).map(row=>JSON.parse(row.body))};
  for (const row of caches) { const target={chart:data.charts,character:data.characters,alias:data.aliases}[row.kind]; if(target) target[row.key]=JSON.parse(row.body); }
  sources.push({name:'D1',data});
}
const merged=mergeLegacy(sources);
const report={mode:values.apply?'apply':values.verify?'verify':'dry-run',sources:sources.map(source=>({name:source.name,snapshots:source.data.snapshots.length,points:source.data.points.length})),snapshots:merged.snapshots.length,points:merged.points.size,dailyPoints:merged.daily.length,charts:Object.keys(merged.charts).length,characters:Object.keys(merged.characters).length,aliases:Object.keys(merged.aliases).length,logs:merged.logs.length,conflicts:merged.conflicts,fingerprints:merged.snapshots.map(snapshot=>({id:snapshot.id,hash:hash(fingerprint(snapshot))})),daily:merged.daily};
await mkdir(new URL('../.migration/', import.meta.url),{recursive:true});
await writeFile(values.report,JSON.stringify(report,null,2)+'\n');
if (merged.conflicts.length) throw new Error(`Conflicting B50 data: review ${values.report} before importing`);
const statements=[];
for (const snapshot of merged.snapshots) statements.push(['INSERT INTO snapshots(id,fetched_at,local_date,potential,fingerprint,body,backed_up) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,potential=excluded.potential,fingerprint=excluded.fingerprint,backed_up=MAX(snapshots.backed_up,excluded.backed_up)',[snapshot.id,snapshot.fetchedAt,localDate(snapshot.fetchedAt),snapshot.potential,fingerprint(snapshot),JSON.stringify(snapshot),remoteIds.has(snapshot.id)?1:0]]);
for (const [id,point] of merged.points) statements.push(['INSERT INTO ptt_points(id,local_date,fetched_at,potential,snapshot_id,source) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET potential=excluded.potential,source=excluded.source',[id,point.date,point.fetchedAt,point.potential,point.snapshotId||'',point.source||null]]);
for (const [kind,map] of [['chart',merged.charts],['character',merged.characters],['alias',merged.aliases]]) for(const [key,value] of Object.entries(map)) statements.push(['INSERT INTO cache(kind,key,body) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body',[kind,key,JSON.stringify(value)]]);
for(const log of merged.logs) statements.push(['INSERT INTO logs(id,timestamp,body) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',[log.id,log.timestamp,JSON.stringify(log)]]);
statements.push(['DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp DESC,id DESC LIMIT -1 OFFSET 500)',[]]);
if(values.sql){const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";await writeFile(values.sql,statements.map(([sql,params])=>{let i=0;return sql.replace(/\?/g,()=>literal(params[i++]))+';';}).join('\n'));}
if(values.apply) {
  const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";
  let batch='';
  for (const [sql,params] of statements) {
    let index=0;const statement=sql.replace(/\?/g,()=>literal(params[index++]))+';\n';
    if (Buffer.byteLength(batch+statement)>80000 && batch) {await query(batch);batch='';}
    batch+=statement;
  }
  if(batch)await query(batch);
}
if(values.apply||values.verify){
  const actual=await query('SELECT id,fingerprint FROM snapshots ORDER BY id');
  const expected=new Map(report.fingerprints.map(row=>[row.id,row.hash]));
  if(actual.length!==expected.size||actual.some(row=>hash(row.fingerprint)!==expected.get(row.id))) throw new Error('Snapshot verification failed');
  const daily=await query('SELECT date,potential,fetchedAt FROM (SELECT local_date AS date,potential,fetched_at AS fetchedAt,ROW_NUMBER() OVER(PARTITION BY local_date ORDER BY potential DESC,fetched_at DESC,id DESC) AS rank FROM ptt_points) WHERE rank=1 ORDER BY date');
  if(hash(daily)!==hash(merged.daily.map(({date,potential,fetchedAt})=>({date,potential,fetchedAt})))) throw new Error('Daily PTT verification failed');
  report.verified=true;
  if(values.apply) await query('INSERT OR REPLACE INTO migration_runs(id,completed_at,report) VALUES(?,?,?)',[hash(report.fingerprints),new Date().toISOString(),JSON.stringify(report)]);
  await writeFile(values.report,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({...report,fingerprints:undefined,daily:undefined},null,2));
