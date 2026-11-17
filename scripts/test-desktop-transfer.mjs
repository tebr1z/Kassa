import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import postgres from 'postgres';
import {openLocalDatabase,openExistingLocalDatabase} from '../desktop/local-database.mjs';
import {prepareTransferPackage,verifyTransferArchive,databaseFingerprint,transferInstructions} from '../desktop/transfer-package.mjs';
import {readArchive} from '../desktop/backup-archive.mjs';

// All paths and databases in this test are fresh fixtures. Never read APPDATA,
// use the actual shop, load secrets or run any live export/restore.
const parent=path.resolve('.local-desktop-data'),root=path.join(parent,'transfer-'+randomUUID()),source=path.join(root,'source'),bin=path.resolve('desktop/vendor/postgres/bin');
const version='9.8.7',installer=path.join(root,`RestaMarket-Setup-${version}.exe`),output=path.join(root,'private-package');
const previousBin=process.env.BIRKASSA_PG_BIN;process.env.BIRKASSA_PG_BIN=bin;
let database,sql,existing,mismatchedWork;
try{
 await mkdir(root,{recursive:true});await writeFile(installer,'MZ fixture installer bytes; never executed.');
 const missing=path.join(root,'missing-shop');
 await assert.rejects(openExistingLocalDatabase(missing),{code:'ENOENT'});await assert.rejects(access(missing),{code:'ENOENT'});
 await assert.rejects(prepareTransferPackage({dataRoot:missing,installer,version,output,pgBin:bin}),{code:'ENOENT'});
 assert.ok(!(await readdir(root)).some(name=>name.includes('.partial-')),'Missing source must not bootstrap a shop or leave a package');
 database=await openLocalDatabase(source,process.cwd(),{port:55456});
 sql=postgres(database.url,{max:1,prepare:false,onnotice:()=>{},connection:{TimeZone:'UTC'}});
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1"),[warehouse]=await sql.unsafe('select id from warehouses limit 1');
 await sql.unsafe("update users set password_hash='fixture-password-hash-only' where id=$1",[admin.id]);
 const [product]=await sql.unsafe("insert into products(sku,name,cost_price,sale_price) values('TRANSFER-FIXTURE','Transfer fixture',7.45,12.5) returning id");
 const [option]=await sql.unsafe("insert into product_options(product_id,label,color,size,attributes,price,cost_price) values($1,'40 · Qırmızı','Qırmızı','40','{\"Qalınlıq\":\"3 mm\"}',15.5,8.5) returning id",[product.id]);
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',23.75,7.45,$3)",[product.id,warehouse.id,admin.id]);
 const [shift]=await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,12) returning id',[admin.branch_id,admin.id]);
 const [sale]=await sql.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,total,buyer_name) values('TRANSFER-SALE',$1,$2,15.5,15.5,'Fixture buyer') returning id",[shift.id,admin.id]);
 await sql.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total,option_id,option_snapshot,product_name_snapshot) values($1,$2,1,15.5,8.5,15.5,$3,$4,$5)',[sale.id,product.id,option.id,'40 · Qırmızı','Transfer fixture']);
 await sql.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',15.5)",[sale.id]);
 await sql.unsafe('create table transfer_future_data (id bigint generated always as identity,description text,value jsonb)');
 await sql.unsafe("insert into transfer_future_data(description,value) values('future-row','{\"notInAnyOldAllowlist\":true}'),(null,null),('future-row','{\"notInAnyOldAllowlist\":true}')");
 // Simulate a closed older installed version, without the new mirror tables /
 // ledger entries. A transfer must NOT upgrade that shop simply to export it.
 await sql.unsafe('drop table desktop_support_messages,desktop_support_inbox,desktop_web_catalog_map');
 await sql.unsafe('alter table desktop_order_inbox drop column import_error,drop column sync_conflict,drop column imported_at');
 for(const file of (await readdir('drizzle')).filter(file=>/^003[789]_.*\.sql$/.test(file))){const hash=createHash('sha256').update(await readFile(path.join('drizzle',file),'utf8')).digest('hex');await sql.unsafe('delete from public.__drizzle_migrations where hash=$1',[hash]);}
 const image=Buffer.from('Private fixture offline image'),imageHash=createHash('sha256').update(image).digest('hex');
 await mkdir(path.join(source,'media'));await writeFile(path.join(source,'media',imageHash+'.bin'),image);await writeFile(path.join(source,'media',imageHash+'.json'),'{}');
 await mkdir(path.join(source,'.private'));await writeFile(path.join(source,'.private','desktop-sync.json'),'fixture-key-must-not-be-copied');
 const expected=await sql.begin('isolation level repeatable read read only',databaseFingerprint),config=await readFile(path.join(source,'database.json'));
 await assert.rejects(openExistingLocalDatabase(source),/bağlayıb/,'Busy app must be closed before export');
 assert.equal((await sql.unsafe('select count(*)::int n from products'))[0].n,1,'Busy refusal must not stop the existing source');
 await sql.end();sql=null;await database.close();database=null;
 existing=await openExistingLocalDatabase(source,{pgBin:bin});
 await assert.rejects(existing.snapshot(({sql:tx})=>tx.unsafe("update users set full_name='MUST NOT CHANGE'")),/read-only/i,'Existing exporter connection never writes');
 await existing.close();existing=null;
 const result=await prepareTransferPackage({dataRoot:source,installer,version,output,pgBin:bin});
 assert.equal(result.verifiedByDisposableRestore,true);assert.equal(result.counts.products,1);assert.equal(result.counts.sales,1);assert.equal(result.counts.stock_movements,1);assert.equal(result.counts.transfer_future_data,3);assert.equal(result.archiveFiles,3);
 assert.deepEqual((await readdir(output)).sort(),['OXU-KOCURME.txt','RestaMarket-Setup-9.8.7.exe','RestaMarket-data.birkassa','manifest.json'].sort());
 const manifest=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
 assert.equal(manifest.sourceMigrationsApplied,false);assert.deepEqual(manifest.tables,expected);
 assert.ok(!manifest.tables.some(table=>table.table==='desktop_web_catalog_map'||table.table==='desktop_support_inbox'),'Exporting an old shop must not silently migrate it');
 assert.ok(manifest.tables.some(table=>table.kind==='sequence'&&table.table==='transfer_future_data_id_seq'),'Identity/receipt sequence states are verified too');
 for(const file of manifest.files){const bytes=await readFile(path.join(output,file.name));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 const instructions=await readFile(path.join(output,'OXU-KOCURME.txt'),'utf8');assert.ok(instructions.includes('RestaMarket-Setup-9.8.7.exe'));assert.ok(instructions.includes('stok'));assert.ok(!instructions.includes('0.6.0'));assert.ok(!instructions.includes('fixture-key-must-not-be-copied'));
 const archive=await readArchive(path.join(output,'RestaMarket-data.birkassa'),path.join(root,'inspect-archive'));
 assert.deepEqual(await readFile(path.join(archive.media,imageHash+'.bin')),image);assert.deepEqual((await readdir(path.dirname(archive.dump))).sort(),['database.dump','media']);
 await assert.rejects(prepareTransferPackage({dataRoot:source,installer,version,output,pgBin:bin}),/artıq mövcuddur/);
 await assert.rejects(prepareTransferPackage({dataRoot:source,installer,version,output:path.join(source,'unsafe-export'),pgBin:bin}),/ayrı olmalıdır/);
 const corrupt=path.join(root,'corrupt.birkassa'),corruptBytes=Buffer.from(await readFile(path.join(output,'RestaMarket-data.birkassa')));corruptBytes[corruptBytes.length-1]^=0xff;await writeFile(corrupt,corruptBytes);
 const corruptWork=path.join(root,'corrupt-verification');await mkdir(corruptWork);await assert.rejects(verifyTransferArchive(corrupt,{bin,workRoot:corruptWork,expected}));
 mismatchedWork=await mkdtemp(path.join(os.tmpdir(),'rm-xfer-test-'));await assert.rejects(verifyTransferArchive(path.join(output,'RestaMarket-data.birkassa'),{bin,workRoot:mismatchedWork,expected:[]}),/eyni deyil/);
 existing=await openExistingLocalDatabase(source,{pgBin:bin});
 assert.deepEqual(await existing.snapshot(({sql:tx})=>databaseFingerprint(tx)),expected,'No source rows, ledger, staff, costs, stock, payments or sequences changed');
 assert.deepEqual(await readFile(path.join(source,'database.json')),config,'Active database configuration is byte-for-byte unchanged');
 assert.equal(await existing.snapshot(async({sql:tx})=>(await tx.unsafe('select password_hash from users where id=$1',[admin.id]))[0].password_hash),'fixture-password-hash-only');
 assert.ok(transferInstructions({version:'1.2.3',createdAt:'fixture',counts:{products:25}}).includes('RestaMarket-Setup-1.2.3.exe'));
 console.log('PASS: fixture-only transfer includes all products/options/stock/sales/items/payments/accounts/media/future tables and sequence states; isolated real restore matches every table; source data/config unchanged; missing/busy sources, unsafe paths, corrupt/mismatched archives rejected; no private pairing file, live profile, network or installer execution.');
}catch(error){
 // This test never opens a real profile; diagnostics contain fixture data only.
 if(error.transferDiagnostic)console.error('Fixture-only PostgreSQL diagnostic:',error.transferDiagnostic);
 throw error;
}finally{
 await sql?.end({timeout:2});await existing?.close();await database?.close();
 if(mismatchedWork){if(path.dirname(mismatchedWork)!==path.resolve(os.tmpdir())||!path.basename(mismatchedWork).startsWith('rm-xfer-test-'))throw new Error('Invalid test work path');await rm(mismatchedWork,{recursive:true,force:true});}
 if(previousBin===undefined)delete process.env.BIRKASSA_PG_BIN;else process.env.BIRKASSA_PG_BIN=previousBin;
 if(path.dirname(root)!==parent||!path.basename(root).startsWith('transfer-'))throw new Error('Invalid fixture cleanup path');
 await rm(root,{recursive:true,force:true});
}
