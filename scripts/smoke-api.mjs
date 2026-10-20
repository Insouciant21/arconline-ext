import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
const origin=process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4321';
const token=process.env.SMOKE_TOKEN || (process.env.SMOKE_ENV_FILE ? parseEnv(await readFile(process.env.SMOKE_ENV_FILE,'utf8')).ADMIN_TOKEN : 'local-test-token');
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});
if(!login.ok)throw new Error(`Login ${login.status}: ${await login.text()}`);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function request(path,method='GET') {
 const response=await fetch(origin+path,{method,headers:{origin,cookie}});
 const body=await response.text();
 if(!response.ok)throw new Error(`${path} ${response.status}: ${body.slice(0,300)}`);
 if(!response.headers.get('content-type')?.includes('application/json'))throw new Error(`${path} returned non-JSON (${response.status})`);
 return JSON.parse(body);
}
const health=await request('/api/health');const dashboard=await request('/api/dashboard');
console.log(JSON.stringify({origin,health,latest:dashboard.latest?.id,days:dashboard.history.length}));
const retry=process.argv.find(arg=>arg.startsWith('--retry='))?.slice(8);
if(process.argv.includes('--sync') || process.argv.includes('--import') || process.argv.includes('--media') || retry){
 const endpoint=process.argv.includes('--media')?'/api/media/retry':retry?`/api/jobs/${retry}/retry`:process.argv.includes('--sync')?'/api/sync':'/api/history/import';
 const queued=await request(endpoint,'POST');console.log(JSON.stringify(queued));
 let previous='';
 for(let i=0;i<180;i++){
  const job=await request(`/api/jobs/${queued.jobId}`);
  const state=job.status+':'+job.stage+':'+job.progress.completed;
  if(state!==previous){console.log(JSON.stringify({jobId:job.id,status:job.status,stage:job.stage,progress:job.progress,error:job.error}));previous=state;}
  if(job.status==='failed')throw new Error(job.error);
  if(job.status==='succeeded'){console.log(JSON.stringify({result:job.result?.message,recorded:job.result?.recorded}));break;}
  if(i===179)throw new Error('Job timeout');
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
}
