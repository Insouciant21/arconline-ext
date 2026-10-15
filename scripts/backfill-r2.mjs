import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { query } from './lib/cloudflare.mjs';
const apply=process.argv.includes('--apply');
const rows=await query('SELECT id,body FROM snapshots WHERE backed_up=0 ORDER BY fetched_at');
console.log(JSON.stringify({mode:apply?'apply':'dry-run',snapshots:rows.length}));
if(apply){
 const client=new S3Client({region:'auto',endpoint:process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
 for(const row of rows){
  const snapshot=JSON.parse(row.body);
  await client.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME || process.env.R2_BUCKET,Key:`snapshots/${row.id}.json`,Body:JSON.stringify(snapshot,null,2)+'\n',ContentType:'application/json; charset=utf-8',CacheControl:'no-cache',Metadata:{kind:'b50-snapshot',snapshotId:row.id,fetchedAt:snapshot.fetchedAt}}));
  await query('UPDATE snapshots SET backed_up=1 WHERE id=? AND body=?',[row.id,row.body]);
 }
 console.log('Snapshot backup backfill complete');
}
