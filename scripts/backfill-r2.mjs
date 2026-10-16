import { withArchive } from './lib/archive.mjs';
import { query } from './lib/cloudflare.mjs';
const apply=process.argv.includes('--apply');
const rows=await query('SELECT id,body FROM snapshots WHERE backed_up=0 ORDER BY fetched_at');
console.log(JSON.stringify({mode:apply?'apply':'dry-run',snapshots:rows.length}));
if(apply && rows.length){
 await withArchive(async archive => {
 for(const row of rows){
  const snapshot=JSON.parse(row.body);
  await archive.put(`snapshots/${row.id}.json`,JSON.stringify(snapshot,null,2)+'\n',{
   httpMetadata:{contentType:'application/json; charset=utf-8',cacheControl:'no-cache'},
   customMetadata:{kind:'b50-snapshot',snapshotId:row.id,fetchedAt:snapshot.fetchedAt},
  });
  await query('UPDATE snapshots SET backed_up=1 WHERE id=? AND body=?',[row.id,row.body]);
 }
 });
 console.log('Snapshot backup backfill complete');
}
