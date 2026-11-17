import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,lstat,readdir,chown,chmod,rename,rm,statfs} from 'node:fs/promises';
import {createHash,createPublicKey,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readArchive} from '../desktop/backup-archive.mjs';

// Operator-only, first-time provisioning. Never import a desktop startup module,
// inspect the public site's environment, change Apache, or connect to port5432.
export const centralPaths=Object.freeze({base:'/var/lib/restamarket-central',postgres:'/var/lib/restamarket-central/postgres',socket:'/var/lib/restamarket-central/socket',data:'/var/lib/restamarket-central/data',staging:'/var/lib/restamarket-central/staging',private:'/var/lib/restamarket-central/private',operatorBackups:'/var/lib/restamarket-central/operator-backups',receipt:'/var/lib/restamarket-central/private/provision-receipt.json',backendEnv:'/var/lib/restamarket-central/private/backend.env',gatewayEnv:'/var/lib/restamarket-central/private/gateway.env',registry:'/var/lib/restamarket-central/private/devices.json',pgBin:'/usr/pgsql-17/bin',units:'/etc/systemd/system'});
export const centralUnits=Object.freeze(['restamarket-central-postgres17.service','restamarket-central-backend.service','restamarket-central-gateway.service','restamarket-central-operator-backup.service','restamarket-central-operator-backup.timer']);
const expectedCounts=Object.freeze({products:52,sales:2,stock_movements:58,users:5,warehouses:3});
const hashPattern=/^[a-f0-9]{64}$/,commitPattern=/^[a-f0-9]{40}$/,uuidPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const operator='rmcentralpg',application='rmcentral_app',backupRole='rmcentral_backup',database='restamarket_inventory',pgPort=55433;
const fail=message=>{throw new Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const required=(value,message)=>{if(!value)fail(message);};
function registration(value){
 required(value&&Object.keys(value).sort().join(',')==='active,id,publicKeyPem,schema'&&value.schema===1&&value.active===true&&uuidPattern.test(value.id)&&typeof value.publicKeyPem==='string'&&value.publicKeyPem.length<2048,'Invalid staged public device registration');
 const key=createPublicKey(value.publicKeyPem);required(key.asymmetricKeyType==='ed25519'&&key.export({type:'spki',format:'pem'})===value.publicKeyPem,'The registration must contain exactly one canonical public Ed25519 key');return value;
}
export function centralDeviceRegistry(value){const device=registration(value);return {schema:1,devices:[{id:device.id,publicKeyPem:device.publicKeyPem,active:device.active}]};}
function validateManifest(manifest,archive){
 required(manifest?.format==='restamarket-private-transfer-v1'&&manifest.version==='0.6.6'&&manifest.containsPrivateShopData===true&&manifest.verifiedByDisposableRestore===true&&manifest.sourceMigrationsApplied===false&&Array.isArray(manifest.tables)&&manifest.tables.length>0&&Array.isArray(manifest.files),'A verified private 0.6.6 transfer manifest is required');
 const found=manifest.files.filter(file=>file.name==='RestaMarket-data.birkassa');required(found.length===1&&hashPattern.test(archive?.sha256)&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&found[0].sha256===archive.sha256&&found[0].bytes===archive.bytes,'The staged archive does not match its authorized transfer manifest');
 const names=new Set();for(const row of manifest.tables){required(row&&['table','sequence'].includes(row.kind)&&row.schema==='public'&&/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(row.table)&&Number.isSafeInteger(row.rows)&&row.rows>=0&&hashPattern.test(row.sha256),'Invalid source table fingerprint');const key=row.kind+':'+row.table;required(!names.has(key),'Duplicate source fingerprint');names.add(key);}
 for(const [table,count]of Object.entries(expectedCounts)){required(manifest.counts?.[table]===count&&manifest.tables.some(row=>row.kind==='table'&&row.table===table&&row.rows===count),'Unexpected authorized source count: '+table);}
 return manifest;
}

// Pure plan: callers cannot provide filesystem/SQL targets. Runtime checks below
// independently establish every fact before this plan can authorize mutations.
export function buildCentralPlan({commit,release,postgresVersion,platform,uid,trustedRelease,stage,existing={}}){
 required(platform==='linux'&&uid===0,'Central provisioning requires an explicit Linux root operator');
 required(commitPattern.test(commit||'')&&release?.commit===commit&&release.platform==='linux'&&release.arch==='x64'&&typeof release.version==='string'&&trustedRelease===true,'Only the exact trusted Linux release can be provisioned');
 required(/^postgres \(PostgreSQL\) 17\.[0-9]+(?:\s|$)/.test(postgresVersion||''),'The separately verified PostgreSQL17 binaries are required');
 validateManifest(stage?.manifest,stage?.archive);registration(stage?.registration);
 for(const name of ['manifestSha256','registrationSha256','pairingSha256'])required(hashPattern.test(stage?.[name]),'Missing staged input checksum');
 const identity={commit,archiveSha256:stage.archive.sha256,manifestSha256:stage.manifestSha256,registrationSha256:stage.registrationSha256,pairingSha256:stage.pairingSha256};
 if(existing.receipt){required(existing.receipt.schema===1&&existing.receipt.status==='prepared'&&Object.entries(identity).every(([key,value])=>existing.receipt[key]===value),'Partial or mismatched provisioning receipt: explicit operator recovery is required');return {action:'verify-existing',identity,targets:centralPaths,units:centralUnits,postgresPort:pgPort,backendPort:5791,gatewayPort:5790};}
 required(!existing.cluster&&!existing.nonemptyTargets&&!existing.units?.length&&!existing.configuration,'Existing central targets without a complete ownership receipt cannot be reused');
 return {action:'prepare-new',identity,targets:centralPaths,units:centralUnits,postgresPort:pgPort,backendPort:5791,gatewayPort:5790,expectedCounts,publicSiteChanges:false,publicPostgresChanges:false,startBackend:false,startGateway:false,startBackupTimer:false};
}

async function execute(program,args,{input,inputStream,accepted=[0],maximum=16*1024*1024,environment={}}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin',LANG:'C.UTF-8',...environment}});let out='',err='',overflow=false;
  child.stdout.on('data',part=>{out+=part;if(Buffer.byteLength(out)>maximum){overflow=true;child.kill('SIGTERM');}});child.stderr.on('data',part=>{if(err.length<65536)err+=part;});
  child.once('error',()=>reject(new Error('Required operator command could not start: '+path.basename(program))));
  child.once('exit',code=>{if(accepted.includes(code)&&!overflow)resolve({code,output:out.trim()});else{const error=new Error('Operator step failed: '+path.basename(program));Object.defineProperty(error,'privateDiagnostic',{value:err});reject(error);}});
  child.stdin.on('error',()=>{});if(inputStream){inputStream.on('error',()=>child.kill('SIGTERM'));inputStream.pipe(child.stdin);}else child.stdin.end(input||'');
 });
}
async function exists(file){try{return await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function noLinks(file,{fileOnly=false,rootOwned=false,privateMode=false}={}){
 const resolved=path.resolve(file);required(resolved===file&&path.isAbsolute(file)&&file!=='/','An exact absolute operator path is required');let cursor='/';
 for(const segment of resolved.slice(1).split('/')){cursor=path.join(cursor,segment);const info=await lstat(cursor);required(!info.isSymbolicLink(),'Linked operator paths are forbidden');if(cursor!==file)required(info.isDirectory(),'Operator parent is not a directory');if(rootOwned)required(info.uid===0&&(info.mode&0o022)===0,'Operator path is not protected by root');}
 const info=await lstat(file);required(fileOnly?info.isFile()&&info.nlink===1:info.isDirectory(),'Unexpected operator path type');if(privateMode)required((info.mode&0o077)===0,'Private staged input permissions are too broad');return info;
}
async function hashFile(file){const value=createHash('sha256');for await(const part of createReadStream(file))value.update(part);return value.digest('hex');}
async function rootJson(file,maximum=16*1024*1024){const info=await noLinks(file,{fileOnly:true,rootOwned:true,privateMode:true});required(info.size<=maximum,'Oversized private operator input');return JSON.parse(await readFile(file,'utf8'));}
async function directory(file,uid=0,gid=0,mode=0o700){
 const item=await exists(file);if(!item)await mkdir(file,{mode});else required(item.isDirectory()&&!item.isSymbolicLink(),'Unsafe central directory');await chown(file,uid,gid);await chmod(file,mode);
}
async function newFile(file,content,{uid=0,gid=0,mode=0o600}={}){await writeFile(file,content,{flag:'wx',mode});await chown(file,uid,gid);await chmod(file,mode);}
async function account(name,home){
 let result=await execute('/usr/bin/getent',['passwd',name],{accepted:[0,2]});
 if(result.code===2){await execute('/usr/sbin/useradd',['--system','--no-create-home','--home-dir',home,'--shell','/sbin/nologin','--user-group',name]);result=await execute('/usr/bin/getent',['passwd',name]);}
 const row=result.output.split(':');required(row.length===7&&row[0]===name&&Number(row[2])>0&&Number(row[3])>0&&row[5]===home&&['/sbin/nologin','/usr/sbin/nologin'].includes(row[6]),'Existing service account does not belong to this deployment');
 return {uid:Number(row[2]),gid:Number(row[3])};
}
async function psql(sql,db='postgres'){
 required(['postgres',database].includes(db),'Unapproved operator database');
 return(await execute('/usr/sbin/runuser',['-u',operator,'--',centralPaths.pgBin+'/psql','-X','-h',centralPaths.socket,'-p',String(pgPort),'-U',operator,'-d',db,'-v','ON_ERROR_STOP=1','-q','-A','-t'],{input:sql+'\n'})).output;
}
function pgUnit(){return `[Unit]\nDescription=RestaMarket isolated PostgreSQL17 inventory\nAfter=network.target\n\n[Service]\nType=simple\nUser=rmcentralpg\nGroup=rmcentralpg\nExecStart=/usr/pgsql-17/bin/postgres -D ${centralPaths.postgres}\nExecStop=/usr/pgsql-17/bin/pg_ctl -D ${centralPaths.postgres} -m fast -w stop\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=60\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths=${centralPaths.postgres} ${centralPaths.socket}\nMemoryMax=192M\nMemorySwapMax=128M\n\n[Install]\nWantedBy=multi-user.target\n`;}
function nodeUnit({description,user,release,script,memory,heap,environment,writePaths='',after=centralUnits[0],type='simple'}){return `[Unit]\nDescription=${description}\nAfter=network.target ${after}\nRequires=${centralUnits[0]}\n\n[Service]\nType=${type}\nUser=${user}\nGroup=${user}\nWorkingDirectory=${release}\n${environment?'EnvironmentFile='+environment+'\n':''}Environment=NODE_ENV=production\nExecStart=/usr/bin/node --max-old-space-size=${heap} ${release}/${script}\n${type==='simple'?'Restart=on-failure\nRestartSec=5\n':''}UMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\n${writePaths?'ReadWritePaths='+writePaths+'\n':''}RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nMemoryMax=${memory}M\nMemorySwapMax=128M\n\n[Install]\nWantedBy=multi-user.target\n`;}
function units(release){return new Map([
 [centralUnits[0],pgUnit()],
 [centralUnits[1],nodeUnit({description:'RestaMarket private central inventory backend',user:'rmcentral',release,script:'server.js',memory:384,heap:192,environment:centralPaths.backendEnv,writePaths:centralPaths.data})],
 [centralUnits[2],nodeUnit({description:'RestaMarket authenticated desktop gateway',user:'rmgateway',release,script:'scripts/start-central-gateway.mjs',memory:128,heap:64,environment:centralPaths.gatewayEnv,after:centralUnits[1]})],
 [centralUnits[3],nodeUnit({description:'RestaMarket private full operator disaster recovery backup',user:operator,release,script:'scripts/central-operator-backup.mjs',memory:128,heap:64,writePaths:centralPaths.operatorBackups,type:'oneshot'})],
 [centralUnits[4],`[Unit]\nDescription=Daily RestaMarket full inventory and reset-ledger backup\n\n[Timer]\nOnCalendar=*-*-* 03:30:00\nPersistent=true\nUnit=${centralUnits[3]}\n\n[Install]\nWantedBy=timers.target\n`],
]);}
async function fingerprint(release){
 const code=`import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {databaseFingerprint} from ${JSON.stringify(pathToFileURL(path.join(release,'desktop/database-fingerprint.mjs')).href)};const require=createRequire(${JSON.stringify(path.join(release,'server.js'))}),postgres=require('postgres'),sql=postgres({host:${JSON.stringify(centralPaths.socket)},port:${pgPort},username:${JSON.stringify(operator)},database:${JSON.stringify(database)},max:1,prepare:false,connect_timeout:5,onnotice:()=>{},connection:{TimeZone:'UTC',default_transaction_read_only:'on'}});try{process.stdout.write(JSON.stringify(await sql.begin('isolation level repeatable read read only',databaseFingerprint)));}finally{await sql.end({timeout:3});}`;
 return JSON.parse((await execute('/usr/sbin/runuser',['-u',operator,'--','/usr/bin/node','--max-old-space-size=64','--input-type=module'],{input:code})).output);
}
async function migrate(release){
 const files=(await readdir(path.join(release,'drizzle'))).filter(name=>/^[0-9]{4}[^/]*\.sql$/.test(name)).sort(),applied=[];
 for(const file of files){const source=await readFile(path.join(release,'drizzle',file),'utf8'),hash=sha(source);if(await psql('select exists(select 1 from public.__drizzle_migrations where hash='+literal(hash)+');',database)==='t')continue;
  const statements=source.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean).join('\n');await psql('BEGIN;\n'+statements+'\nINSERT INTO public.__drizzle_migrations(hash,created_at) VALUES('+literal(hash)+','+Date.now()+');\nCOMMIT;',database);applied.push(file);
 }return applied;
}
async function counts(){return JSON.parse(await psql("select json_build_object('products',(select count(*) from public.products),'sales',(select count(*) from public.sales),'stock_movements',(select count(*) from public.stock_movements),'users',(select count(*) from public.users),'warehouses',(select count(*) from public.warehouses),'desktop_order_inbox',(select count(*) from public.desktop_order_inbox),'desktop_sync_outbox',(select count(*) from public.desktop_sync_outbox),'auth_sessions',(select count(*) from public.auth_sessions));",database));}
async function copyMedia(source,target,owner){
 const info=await exists(source);if(!info)return;required(info.isDirectory()&&!info.isSymbolicLink(),'Invalid extracted media directory');await directory(target,owner.uid,owner.gid);
 for(const entry of await readdir(source,{withFileTypes:true})){required(entry.isFile()&&!entry.isSymbolicLink()&&/^[a-f0-9]{64}\.(bin|json)$/.test(entry.name),'Invalid extracted media entry');const data=await readFile(path.join(source,entry.name));await newFile(path.join(target,entry.name),data,owner);}
}
async function verifyCompleted(receipt,release){
 required(receipt.release===release&&receipt.database===database&&receipt.postgresPort===pgPort,'The existing central receipt does not match fixed targets');
 for(const [file,expected]of Object.entries(receipt.protectedFiles||{})){required([centralPaths.backendEnv,centralPaths.gatewayEnv,centralPaths.registry,...centralUnits.map(name=>path.join(centralPaths.units,name))].includes(file),'Invalid protected receipt target');await noLinks(file,{fileOnly:true,rootOwned:true});required(await hashFile(file)===expected,'A prepared central configuration changed; explicit operator review is required');}
 required(Object.keys(receipt.protectedFiles||{}).length===8,'Incomplete protected-file receipt');
 await noLinks(centralPaths.postgres);required((await readFile(path.join(centralPaths.postgres,'PG_VERSION'),'utf8')).trim()==='17','Prepared central PostgreSQL version changed');
 return {prepared:true,alreadyPrepared:true,commit:receipt.commit,counts:receipt.counts,backendStarted:false,gatewayStarted:false,backupTimerStarted:false};
}

export async function prepareCentralServer(commit){
 required(process.platform==='linux'&&process.getuid?.()===0,'Run this operator command only as Linux root');required(commitPattern.test(commit||''),'An exact verified release commit is required');
 const release='/opt/restamarket-central/releases/'+commit;await noLinks(release,{rootOwned:true});
 for(const name of ['release.json','server.js','desktop/backup-archive.mjs','desktop/database-fingerprint.mjs','scripts/central-reset-policy.sql','scripts/start-central-gateway.mjs','scripts/central-operator-backup.mjs'])await noLinks(path.join(release,name),{fileOnly:true,rootOwned:true});
 const metadata=JSON.parse(await readFile(path.join(release,'release.json'),'utf8'));for(const name of ['initdb','postgres','psql','pg_restore','pg_ctl'])await noLinks(path.join(centralPaths.pgBin,name),{fileOnly:true,rootOwned:true});
 const version=(await execute(centralPaths.pgBin+'/postgres',['--version'])).output;
 await noLinks(centralPaths.base,{rootOwned:true});await noLinks(centralPaths.staging,{rootOwned:true});
 const archiveFile=path.join(centralPaths.staging,'RestaMarket-data.birkassa'),manifestFile=path.join(centralPaths.staging,'transfer-manifest.json'),registrationFile=path.join(centralPaths.staging,'device-registration.json'),pairingFile=path.join(centralPaths.staging,'desktop-sync.json');
 const archiveInfo=await noLinks(archiveFile,{fileOnly:true,rootOwned:true,privateMode:true}),manifest=await rootJson(manifestFile),device=await rootJson(registrationFile,8192),pairing=await rootJson(pairingFile,8192);
 required(pairing&&Object.keys(pairing).sort().join(',')==='key,url'&&pairing.url==='https://kassa.nex.autos'&&/^bk_catalog_[a-f0-9]{64}$/.test(pairing.key),'The exact existing website pairing must be explicitly staged');
 const stage={archive:{bytes:archiveInfo.size,sha256:await hashFile(archiveFile)},manifest,registration:device,manifestSha256:await hashFile(manifestFile),registrationSha256:await hashFile(registrationFile),pairingSha256:await hashFile(pairingFile)};
 const priorReceipt=await exists(centralPaths.receipt)?await rootJson(centralPaths.receipt):null;
 const configuration=Boolean(await exists(centralPaths.backendEnv)||await exists(centralPaths.gatewayEnv)||await exists(centralPaths.registry));
 const foundUnits=[];for(const name of centralUnits)if(await exists(path.join(centralPaths.units,name)))foundUnits.push(name);
 let nonemptyTargets=false;for(const target of [centralPaths.postgres,centralPaths.socket,centralPaths.data,centralPaths.private,centralPaths.operatorBackups]){const info=await exists(target);if(info){required(info.isDirectory()&&!info.isSymbolicLink(),'Unsafe existing central target');if((await readdir(target)).length)nonemptyTargets=true;}}
 const plan=buildCentralPlan({commit,release:metadata,postgresVersion:version,platform:process.platform,uid:process.getuid(),trustedRelease:true,stage,existing:{receipt:priorReceipt,cluster:Boolean(await exists(path.join(centralPaths.postgres,'PG_VERSION'))),configuration,units:foundUnits,nonemptyTargets}});
 if(plan.action==='verify-existing')return verifyCompleted(priorReceipt,release);
 const disk=await statfs(centralPaths.base);required(Number(disk.bavail)*Number(disk.bsize)>Math.max(512*1024*1024,archiveInfo.size*8),'Not enough private disk space for a verified central restore');
 // Claim before creating any cluster, credentials or unit. A crash leaves a
 // private explicit-recovery receipt; an unattended rerun can never re-import.
 await directory(centralPaths.base,0,0,0o711);await directory(centralPaths.private);const receipt={schema:1,status:'preparing',deploymentId:randomUUID(),...plan.identity,release,database,postgresPort:pgPort,createdAt:new Date().toISOString()};await newFile(centralPaths.receipt,JSON.stringify(receipt,null,2));
 const pgAccount=await account(operator,centralPaths.postgres),appAccount=await account('rmcentral',centralPaths.data),gatewayAccount=await account('rmgateway',centralPaths.private);
 await directory(centralPaths.postgres,pgAccount.uid,pgAccount.gid);await directory(centralPaths.socket,pgAccount.uid,pgAccount.gid);await directory(centralPaths.data,appAccount.uid,appAccount.gid);await directory(centralPaths.operatorBackups,pgAccount.uid,pgAccount.gid);await chown(centralPaths.private,0,gatewayAccount.gid);await chmod(centralPaths.private,0o710);
 await execute('/usr/sbin/runuser',['-u',operator,'--',centralPaths.pgBin+'/initdb','-D',centralPaths.postgres,'--auth-local=peer','--auth-host=scram-sha-256','--username='+operator,'--encoding=UTF8','--no-locale']);
 const configurationText=`\n# RestaMarket isolated cluster. No public-site PostgreSQL settings are read.\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nunix_socket_directories = '${centralPaths.socket}'\nunix_socket_permissions = 0700\nshared_buffers = '32MB'\nmax_connections = 30\nwork_mem = '2MB'\nmaintenance_work_mem = '16MB'\npassword_encryption = 'scram-sha-256'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n`;
 await writeFile(path.join(centralPaths.postgres,'postgresql.conf'),configurationText,{flag:'a'});
 const hba=`local all ${operator} peer\nlocal all all reject\nhost all ${operator} 127.0.0.1/32 reject\nhost ${database} ${application} 127.0.0.1/32 scram-sha-256\nhost all ${backupRole} 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\nhost all all ::1/128 reject\n`;
 await writeFile(path.join(centralPaths.postgres,'pg_hba.conf'),hba);for(const file of ['postgresql.conf','pg_hba.conf']){await chown(path.join(centralPaths.postgres,file),pgAccount.uid,pgAccount.gid);await chmod(path.join(centralPaths.postgres,file),0o600);}
 const unitContents=units(release);await newFile(path.join(centralPaths.units,centralUnits[0]),unitContents.get(centralUnits[0]),{mode:0o644});await execute('/usr/bin/systemctl',['daemon-reload']);await execute('/usr/bin/systemctl',['start',centralUnits[0]]);
 const pgIdentity=JSON.parse(await psql("select json_build_object('port',current_setting('port'),'version',current_setting('server_version_num'),'directory',current_setting('data_directory'),'username',current_user);"));required(pgIdentity.port===String(pgPort)&&/^17[0-9]{4}$/.test(pgIdentity.version)&&pgIdentity.directory===centralPaths.postgres&&pgIdentity.username===operator,'The new operator connection is not the isolated PostgreSQL17 service');await psql('ALTER ROLE '+operator+' PASSWORD NULL;');
 await psql('CREATE DATABASE '+database+' OWNER '+operator+' TEMPLATE template0 ENCODING \'UTF8\';');
 const work=path.join(centralPaths.staging,'restore-'+receipt.deploymentId);await mkdir(work,{mode:0o700});const extracted=await readArchive(archiveFile,work);
 const toc=(await execute(centralPaths.pgBin+'/pg_restore',['--list'],{inputStream:createReadStream(extracted.dump)})).output;
 if(/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s/m.test(toc))await psql('DROP SCHEMA public;',database);
 await execute('/usr/sbin/runuser',['-u',operator,'--',centralPaths.pgBin+'/pg_restore','-h',centralPaths.socket,'-p',String(pgPort),'-U',operator,'-d',database,'--no-owner','--no-acl','--exit-on-error'],{inputStream:createReadStream(extracted.dump)});
 const restored=await fingerprint(release);required(JSON.stringify(restored)===JSON.stringify(manifest.tables),'Restored central data differs from the authorized source fingerprint');
 const before=await counts();for(const [table,count]of Object.entries(expectedCounts))required(before[table]===count,'Restored source count differs: '+table);required(before.auth_sessions===0,'Unexpected active sessions in the authorized source archive');
 const migrations=await migrate(release),after=await counts();for(const [table,count]of Object.entries(expectedCounts))required(after[table]===count,'Migration changed protected business rows: '+table);required(after.desktop_order_inbox===before.desktop_order_inbox,'Migration changed preserved web inbox rows');
 const clientIdentity=await psql("select value from public.system_settings where key='desktop_sync_client_id';",database);required(uuidPattern.test(clientIdentity),'The existing website client identity must be preserved');
 const revision=(BigInt(Date.now())*1000n).toString();await psql("BEGIN; DELETE FROM public.desktop_sync_outbox; DELETE FROM public.system_settings WHERE key='desktop_catalog_digest'; SELECT setval('public.desktop_sync_outbox_revision_seq',greatest((select last_value from public.desktop_sync_outbox_revision_seq),"+revision+"::bigint),true); COMMIT;",database);
 required(await psql("select value from public.system_settings where key='desktop_sync_client_id';",database)===clientIdentity,'Website pairing identity changed');
 const masterIds=(await psql("select id from public.users where role='admin' and is_active=true and password_hash is not null order by id;",database)).split('\n').filter(Boolean);required(masterIds.length===1&&uuidPattern.test(masterIds[0]),'Explicit master selection required: source must have exactly one active password-ready administrator');
 const appPassword=randomBytes(32).toString('hex'),backupPassword=randomBytes(32).toString('hex'),accessToken=randomBytes(32).toString('hex'),nativeToken=randomBytes(32).toString('hex');
 await psql('CREATE ROLE '+application+' LOGIN PASSWORD '+literal(appPassword)+' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE '+backupRole+' LOGIN PASSWORD '+literal(backupPassword)+' NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; REVOKE ALL ON DATABASE '+database+' FROM PUBLIC; GRANT CONNECT ON DATABASE '+database+' TO '+application+','+backupRole+';');
 await psql('REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO '+application+','+backupRole+'; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO '+application+'; GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO '+application+'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+backupRole+'; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO '+backupRole+';',database);
 const policy=await readFile(path.join(release,'scripts/central-reset-policy.sql'),'utf8');await psql("SELECT set_config('restamarket.application_role',"+literal(application)+",false);\n"+policy+'\nSELECT restamarket_control.initialize_sales_reset_policy('+literal(masterIds[0])+'::uuid);',database);
 const pairingDirectory=path.join(centralPaths.data,'.private');await directory(pairingDirectory,appAccount.uid,appAccount.gid);await newFile(path.join(pairingDirectory,'desktop-sync.json'),await readFile(pairingFile),appAccount);await copyMedia(extracted.media,path.join(centralPaths.data,'media'),appAccount);
 const backendEnvironment={NODE_ENV:'production',DATABASE_URL:`postgres://${application}:${appPassword}@127.0.0.1:${pgPort}/${database}`,BIRKASSA_BACKUP_DATABASE_URL:`postgres://${backupRole}:${backupPassword}@127.0.0.1:${pgPort}/${database}`,BIRKASSA_LOCAL:'1',BIRKASSA_CENTRAL:'1',BIRKASSA_DESKTOP_ACCESS_TOKEN:accessToken,BIRKASSA_DESKTOP_TOKEN:nativeToken,BIRKASSA_DATA_DIR:centralPaths.data,BIRKASSA_PG_BIN:centralPaths.pgBin,PORT:'5791',HOSTNAME:'127.0.0.1'};
 const gatewayEnvironment={NODE_ENV:'production',BIRKASSA_DESKTOP_ACCESS_TOKEN:accessToken,BIRKASSA_DESKTOP_TOKEN:nativeToken,RESTAMARKET_CENTRAL_BACKEND_ORIGIN:'http://127.0.0.1:5791',RESTAMARKET_CENTRAL_GATEWAY_PORT:'5790',RESTAMARKET_CENTRAL_REGISTRY:centralPaths.registry,BIRKASSA_CENTRAL_POLL:'1'};
 const environment=value=>Object.entries(value).map(([key,item])=>key+'='+item+'\n').join('');await newFile(centralPaths.backendEnv,environment(backendEnvironment),{uid:0,gid:appAccount.gid,mode:0o640});await newFile(centralPaths.gatewayEnv,environment(gatewayEnvironment),{uid:0,gid:gatewayAccount.gid,mode:0o640});await newFile(centralPaths.registry,JSON.stringify(centralDeviceRegistry(device),null,2),{uid:0,gid:gatewayAccount.gid,mode:0o640});
 for(const [name,content]of unitContents)if(name!==centralUnits[0])await newFile(path.join(centralPaths.units,name),content,{mode:0o644});await execute('/usr/bin/systemctl',['daemon-reload']);
 const protectedFiles={};for(const file of [centralPaths.backendEnv,centralPaths.gatewayEnv,centralPaths.registry,...centralUnits.map(name=>path.join(centralPaths.units,name))])protectedFiles[file]=await hashFile(file);
 const completed={...receipt,status:'prepared',preparedAt:new Date().toISOString(),counts:after,sourceVerifiedAllTables:true,sourceFingerprintEntries:restored.length,migrations,sourceClientIdentityPreserved:true,outboxBefore:before.desktop_sync_outbox,outboxCleared:true,registeredDevices:1,protectedFiles};
 const temporary=centralPaths.receipt+'.'+receipt.deploymentId+'.tmp';await newFile(temporary,JSON.stringify(completed,null,2));await rename(temporary,centralPaths.receipt);
 // This exact fresh extraction belongs to this completed attempt. Keep original
 // staged archive/manifest/registration/pairing and every operator backup intact.
 required(path.dirname(work)===centralPaths.staging&&path.basename(work)==='restore-'+receipt.deploymentId,'Unsafe extraction cleanup');await rm(work,{recursive:true});
 return {prepared:true,alreadyPrepared:false,commit,counts:after,sourceVerifiedAllTables:true,registeredDevices:1,backendStarted:false,gatewayStarted:false,backupTimerStarted:false,publicSiteChanged:false};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.length!==4||process.argv[2]!=='--prepare'||!commitPattern.test(process.argv[3])){console.error('Explicit operator invocation required: --prepare <verified-40-hex-commit>');process.exitCode=1;}
 else try{console.log(JSON.stringify(await prepareCentralServer(process.argv[3])));}catch(error){console.error(error instanceof Error?error.message:'Central preparation failed closed');process.exitCode=1;}
}
