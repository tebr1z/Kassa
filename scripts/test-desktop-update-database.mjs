import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,stat,rm,symlink,unlink} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {readArchive} from '../desktop/backup-archive.mjs';
import {protectData} from '../desktop/protect-data.mjs';

// Every database and file in this test belongs to this newly generated fixture.
// Do not load environment files, use an existing user profile, or restore a DB.
const fixtureParent=path.resolve('.local-desktop-data');
const fixture=path.join(fixtureParent,'update-database-'+randomUUID());
const bin=path.resolve('desktop/vendor/postgres/bin');
const port=55440;
const previousBin=process.env.BIRKASSA_PG_BIN;
const pools=new Set();
let database,stopped=true,phase='fixture setup';
function command(file,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errorOutput='';
  child.stdout.on('data',part=>{output+=part;if(output.length>16*1024*1024)child.kill();});
  child.stderr.on('data',part=>{errorOutput+=part;});child.once('error',reject);
  child.once('exit',code=>code===0?resolve(output):reject(Error(path.basename(file)+' fixture verification failed ('+code+'): '+errorOutput)));
 });
}
async function connect(){const sql=postgres(database.url,{max:1,prepare:false,connect_timeout:5});pools.add(sql);await sql.unsafe('select 1');return sql;}
async function end(sql){await sql.end({timeout:2});pools.delete(sql);}
async function snapshot(sql){
 const tables=await sql.unsafe("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
 const data={};
 for(const {table_name:table} of tables){
  assert.match(table,/^[a-z_][a-z0-9_]*$/);
  const [row]=await sql.unsafe(`select coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'[]'::jsonb) rows from "${table}" source`);
  data[table]=row.rows;
 }
 return data;
}
try{
 assert.equal((await readFile(path.join(bin,'..','PG_MAJOR'),'utf8')).trim(),'17','Only bundled PostgreSQL 17 is used');
 await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 process.env.BIRKASSA_PG_BIN=bin;
 database=await openLocalDatabase(fixture,process.cwd(),{port});stopped=false;
 phase='seed business fixtures';
 const sql=await connect();
 const [identity]=await sql.unsafe("select current_setting('data_directory') directory,current_database() database,host(inet_server_addr()) host,inet_server_port() port");
 assert.equal(path.resolve(identity.directory).toLowerCase(),path.join(fixture,'postgres').toLowerCase());assert.equal(identity.database,'birkassa');assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,port);
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' order by created_at,id limit 1");
 const [warehouse]=await sql.unsafe('select id from warehouses order by id limit 1');
 const image=Buffer.from('Private fixture image bytes: not a customer image.');
 const imageHash=createHash('sha256').update(image).digest('hex');
 const media=path.join(fixture,'media');await mkdir(media,{recursive:true});
 const imageInfo=Buffer.from(JSON.stringify({mime:'image/png',name:'fixture-update-image.png',fixture:true}));
 await writeFile(path.join(media,imageHash+'.bin'),image);await writeFile(path.join(media,imageHash+'.json'),imageInfo);
 const imageUrl='/api/local-media/'+imageHash;
 const [product]=await sql.unsafe("insert into products(sku,name,category,sale_price,cost_price,min_stock,image_url) values('UPDATE-FIXTURE-SKU','Update fixture product','Fixture category',39.99,17.43,2,$1) returning id",[imageUrl]);
 const [option]=await sql.unsafe("insert into product_options(product_id,label,size,color,kind,price,cost_price,attributes,image_url) values($1,'35 sm · Qırmızı','35 sm','Qırmızı','Polad',45.50,21.17,$2::jsonb,$3) returning id",[product.id,JSON.stringify({thickness:'3 mm',size:'35 sm',color:'Qırmızı'}),imageUrl]);
 await sql.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,0)',[product.id,imageUrl]);
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by,note) values($1,$2,'receipt',12.375,17.43,$3,'Fixture stock for update preservation')",[product.id,warehouse.id,admin.id]);
 const [shift]=await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,50.00) returning id',[admin.branch_id,admin.id]);
 const [sale]=await sql.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,total,buyer_name) values('UPDATE-FIXTURE-RECEIPT',$1,$2,45.50,45.50,'Fixture buyer') returning id",[shift.id,admin.id]);
 await sql.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total,option_id,option_snapshot,product_name_snapshot) values($1,$2,1,45.50,21.17,45.50,$3,$4,$5)',[sale.id,product.id,option.id,JSON.stringify({label:'35 sm · Qırmızı'}),'Update fixture product']);
 await sql.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',45.50)",[sale.id]);
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by,reference_type,reference_id) values($1,$2,'sale',1,21.17,$3,'sale',$4)",[product.id,warehouse.id,admin.id,sale.id]);
 await sql.unsafe("insert into system_settings(key,value) values('desktop_sync_client_id','fixture-device-id'),('desktop_catalog_digest','fixture-public-digest'),('desktop_update_fixture','local-private-setting') on conflict(key) do update set value=excluded.value");
 const before=await snapshot(sql),configBefore=await readFile(path.join(fixture,'database.json'));
 const backups=path.join(fixture,'backups'),archivePath=path.join(backups,'before-update-fixture.birkassa');
 phase='verify update backup';
 await database.backupForUpdate(archivePath);assert.ok((await stat(archivePath)).size>100);
 assert.ok(!(await readdir(backups)).some(name=>name.startsWith('verify-update-')||name.endsWith('.dump')),'Backup verification removes only its temporary verification files');
 const extracted=await readArchive(archivePath,path.join(fixture,'fixture-extracted-backup'));
 assert.equal(extracted.files,3,'The archive contains the full database and both media files');
 assert.deepEqual(await readFile(path.join(extracted.media,imageHash+'.bin')),image);assert.deepEqual(await readFile(path.join(extracted.media,imageHash+'.json')),imageInfo);
 const listing=await command(path.join(bin,'pg_restore.exe'),['--list',extracted.dump]);
 for(const table of ['products','product_options','stock_movements','sales','sale_items','payments','system_settings'])assert.match(listing,new RegExp('TABLE DATA public '+table+'\\b'),'Complete archive includes '+table);
 const dumpData=await command(path.join(bin,'pg_restore.exe'),['--data-only','--file=-',extracted.dump]);
 for(const value of ['UPDATE-FIXTURE-SKU','UPDATE-FIXTURE-RECEIPT','17.43','21.17','12.375','fixture-device-id','local-private-setting'])assert.ok(dumpData.includes(value),'Offline dump inspection includes fixture data '+value);
 assert.deepEqual(await snapshot(sql),before,'Backup and offline validation do not change any business records');
 for(const destination of [path.join(fixture,'outside.birkassa'),path.join(backups,'nested','outside.birkassa'),path.join(backups,'wrong-extension.dump')]){
  await assert.rejects(()=>database.backupForUpdate(destination),/Yanlış yeniləmə ehtiyat yolu/);
  await assert.rejects(()=>stat(destination),{code:'ENOENT'});
 }
 const corrupt=Buffer.from(await readFile(archivePath));corrupt[corrupt.length-1]^=0xff;
 phase='reject corrupt archive and backup failures';
 const corruptPath=path.join(backups,'corrupt-fixture.birkassa');await writeFile(corruptPath,corrupt);
 await assert.rejects(()=>readArchive(corruptPath,path.join(fixture,'fixture-corrupt-inspection')));
 assert.deepEqual(await snapshot(sql),before,'Rejecting a corrupt archive never restores or mutates the current DB');
 const blockedDestination=path.join(backups,'unwritable-target.birkassa');await mkdir(blockedDestination);
 await assert.rejects(()=>database.backupForUpdate(blockedDestination));
 assert.deepEqual(await snapshot(sql),before,'A failed fresh backup leaves the live DB untouched');
 assert.ok(!(await readdir(backups)).some(name=>name.startsWith('verify-update-')||name.endsWith('.dump')),'Failed backup also removes temporary verification files');
 const blocker=await connect();
 phase='refuse shutdown with active clients';
 await assert.rejects(()=>database.closeForUpdate(),/başqa bağlantıda/,'Update shutdown refuses another active database client');
 assert.equal((await blocker.unsafe('select 1 alive'))[0].alive,1,'Refused shutdown leaves the database running');
 await end(blocker);
 await assert.rejects(()=>database.closeForUpdate(),/başqa bağlantıda/,'The ordinary application connection must also close first');
 await end(sql);
 phase='safe update shutdown';
 await database.closeForUpdate();stopped=true;
 await command(path.join(bin,'pg_ctl.exe'),['-D',path.join(fixture,'postgres'),'status']).then(()=>assert.fail('PostgreSQL must have stopped'),error=>assert.ok(error));
 assert.deepEqual(await readFile(path.join(fixture,'database.json')),configBefore,'Update shutdown does not replace database identity or credentials');
 phase='reopen existing fixture without restore';
 database=await openLocalDatabase(fixture,process.cwd(),{port});stopped=false;
 const reopened=await connect();assert.deepEqual(await snapshot(reopened),before,'Ordinary reopening after update preserves every public table without any restore');
 assert.deepEqual(await readFile(path.join(fixture,'database.json')),configBefore);assert.deepEqual(await readFile(path.join(media,imageHash+'.bin')),image);assert.deepEqual(await readFile(path.join(media,imageHash+'.json')),imageInfo);
 assert.equal((await reopened.unsafe('select cost_price::text value from products where id=$1',[product.id]))[0].value,'17.43','Private purchase cost remains local and unchanged');
 await end(reopened);await database.closeForUpdate();stopped=true;
 phase='refuse ACL traversal through directory junctions';
 const guard=path.join(fixture,'acl-guard'),guardRoot=path.join(guard,'private'),outside=path.join(guard,'outside');
 await mkdir(path.join(guardRoot,'nested'),{recursive:true});await mkdir(outside,{recursive:true});
 await writeFile(path.join(outside,'sentinel.txt'),'Outside target must not be changed.');
 const junction=path.join(guardRoot,'nested','outside-link');
 const outsideAcl=await command('icacls.exe',[path.toNamespacedPath(outside)]);
 await symlink(outside,junction,'junction');
 try{
  await assert.rejects(()=>protectData(guardRoot),/keçid/);
  await assert.rejects(()=>protectData(junction),/keçid/);
  assert.equal(await command('icacls.exe',[path.toNamespacedPath(outside)]),outsideAcl,'Refusing links must not change target ACLs outside the chosen data root');
  assert.equal(await readFile(path.join(outside,'sentinel.txt'),'utf8'),'Outside target must not be changed.');
 }finally{await unlink(junction);}
 console.log('PASS: isolated bundled PostgreSQL 17 update backup contains products, variants, stock, private costs, sales, settings and media; archive corruption/path/failure guards preserve data; active clients block shutdown; clean close and reopen preserve all tables/config/media without restore. No real user database was accessed.');
}catch(error){
 console.error('Update database fixture phase: '+phase);
 throw error;
}finally{
 for(const sql of pools)await sql.end({timeout:2}).catch(()=>{});
 if(database&&!stopped){await database.close();stopped=true;}
 if(previousBin===undefined)delete process.env.BIRKASSA_PG_BIN;else process.env.BIRKASSA_PG_BIN=previousBin;
 // Never remove a cluster unless this test successfully stopped it and its
 // resolved target remains the exact UUID fixture under the workspace root.
 if(!stopped||path.dirname(path.resolve(fixture))!==fixtureParent||!/^update-database-[a-f0-9-]{36}$/.test(path.basename(fixture)))throw Error('Unsafe fixture cleanup refused');
 await rm(fixture,{recursive:true,force:true});
}
