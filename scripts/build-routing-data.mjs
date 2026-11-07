import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

if(process.platform!=='linux'||process.env.CI!=='true')throw Error('Build routing data only in the isolated Linux CI runner');
// Official v26.11.0-amd64-debian image, pinned to its published immutable digest.
const image='ghcr.io/project-osrm/osrm-backend@sha256:a2faf149d07b47b0496f4059b73318cb3998ae6e46531b0311085b6e76b6d872';
const root=path.resolve('outputs/routing-build'),data=path.join(root,'data'),name='restamarket-routing-ci';
const run=(file,args,options={})=>execFileSync(file,args,{stdio:'inherit',timeout:900000,...options});
await fs.mkdir(data,{recursive:true});
run('docker',['pull',image]);
const source='https://download.geofabrik.de/asia/azerbaijan-latest.osm.pbf';
const response=await fetch(source,{signal:AbortSignal.timeout(180000)});
if(!response.ok||Number(response.headers.get('content-length'))>200_000_000)throw Error('Unexpected Azerbaijan data response');
const pbf=path.join(data,'azerbaijan.osm.pbf');
await pipeline(Readable.fromWeb(response.body),createWriteStream(pbf));
const hash=async(file,algorithm)=>{const digest=createHash(algorithm);for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');};
let checksum;
for(let attempt=0;attempt<3;attempt++){
 try{checksum=await fetch(source+'.md5',{signal:AbortSignal.timeout(45000)});if(checksum.ok)break;}catch(error){if(attempt===2)throw error;}
}
if(!checksum)throw Error('Source checksum unavailable');
if(!checksum.ok||(await checksum.text()).trim().split(/\s+/)[0]!==await hash(pbf,'md5'))throw Error('Source extract checksum mismatch');
const common=['run','--rm','--network','none','--cpus','2','--memory','5g','-v',data+':/data',image];
run('docker',[...common,'osrm-extract','-t','2','-p','/opt/car.lua','/data/azerbaijan.osm.pbf']);
run('docker',[...common,'osrm-partition','-t','2','/data/azerbaijan.osrm']);
run('docker',[...common,'osrm-customize','-t','2','/data/azerbaijan.osrm']);
const manifest={schema:1,image,region:'Azerbaijan',profile:'car',algorithm:'mld',source,sourceModified:response.headers.get('last-modified'),sourceSha256:await hash(pbf,'sha256'),builtAt:new Date().toISOString(),attribution:'© OpenStreetMap contributors',license:'https://www.openstreetmap.org/copyright'};
await fs.writeFile(path.join(data,'routing-manifest.json'),JSON.stringify(manifest,null,2));
run('docker',['run','-d','--rm','--name',name,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','384m','--memory-swap','512m','--cpus','1','-p','127.0.0.1:5099:5000','-v',data+':/data:ro',image,'osrm-routed','--algorithm','mld','--threads','1','/data/azerbaijan.osrm']);
try{
 let healthy=false;
 for(let attempt=0;attempt<30;attempt++){
  try{
   const r=await fetch('http://127.0.0.1:5099/route/v1/driving/49.763676,40.323879;49.867100,40.409300?overview=false&steps=false&alternatives=false',{signal:AbortSignal.timeout(2000)}),body=await r.json();
   if(r.ok&&body.code==='Ok'&&body.routes[0].distance>1000){healthy=true;console.log('PASS: Azerbaijan public-landmark driving route; constrained 384MB runtime');break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!healthy)throw Error('Constrained routing runtime failed health check');
 run('docker',['stats','--no-stream','--format','{{.MemUsage}}',name]);
}finally{run('docker',['stop',name],{timeout:30000});}
const files=(await fs.readdir(data)).filter(file=>file.startsWith('azerbaijan.osrm.')||file==='routing-manifest.json');
if(files.length<10)throw Error('Incomplete routing graph');
run('tar',['-czf',path.join(root,'restamarket-routing.tar.gz'),'-C',data,...files]);
const artifact=path.join(root,'restamarket-routing.tar.gz');
await fs.writeFile(artifact+'.sha256',await hash(artifact,'sha256')+'  restamarket-routing.tar.gz\n');
console.log('PASS: immutable OSRM image, verified public Azerbaijan extract, private local runtime and graph-only archive; no accounts, addresses or secrets included');
