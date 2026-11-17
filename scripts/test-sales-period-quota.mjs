import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// Every database, account, password, receipt and reset below belongs to this NEW
// disposable cluster. Never open the installed profile or a network database.
const previous={local:process.env.BIRKASSA_LOCAL,token:process.env.BIRKASSA_DESKTOP_TOKEN,url:process.env.DATABASE_URL,bin:process.env.BIRKASSA_PG_BIN,central:process.env.BIRKASSA_CENTRAL,access:process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN,dataRoot:process.env.BIRKASSA_DATA_DIR};
const fixture=path.resolve('.local-desktop-data','reset-quota-'+randomUUID()),secret='reset-quota-fixture-'+randomUUID();
process.env.BIRKASSA_LOCAL='1';process.env.BIRKASSA_DESKTOP_TOKEN=secret;process.env.BIRKASSA_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
delete process.env.BIRKASSA_CENTRAL;
const require=createRequire(import.meta.url),modules=new Map(),pools=new Set();let database,operator,sql,applicationUrl,master,other,warehouse,product,shift,receipt=0;
const applicationRole='quota_app_'+randomUUID().replaceAll('-',''),fixturePassword=randomBytes(32).toString('hex');
const backup={fileName:'before-quota-fixture.birkassa',sha256:'b'.repeat(64),bytes:4096};
async function load(file){
 if(modules.has(file))return modules.get(file);
 const source=await readFile(file,'utf8'),m={exports:{}},mocks={'server-only':{},'@/desktop/central-backups.mjs':await import('../desktop/central-backups.mjs'),'@/lib/log-error':{logSystemError:async()=>{}},'@/lib/store-db':{storeDb:()=>{const pool=postgres(applicationUrl,{max:1,prepare:false,onnotice:()=>{}});pools.add(pool);return pool;}}};
 for(const [,name]of source.matchAll(/from\s*['"](@\/[^'"]+)['"]/g))if(!Object.hasOwn(mocks,name))mocks[name]=await load(name.replace('@/','')+'.ts');
 const compiled=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),m,m.exports);modules.set(file,m.exports);return m.exports;
}
function request({method='GET',token='quota-master',native=false,body}={}){
 return new Request('http://127.0.0.1:5760/api/sales-period',{method,headers:{cookie:'birkassa_session='+token,origin:'http://127.0.0.1:5760','x-restamarket-desktop-access':'c'.repeat(64),...(native?{authorization:'Bearer '+secret}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
const confirmation=preview=>({confirm:'YENİ DÖVR',reason:'Test bitdi: yeni hesabat dövrü',preview:preview.preview,backup});
async function seedSale(){
 const [sale]=await operator.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,total,status,created_at) values($1,$2,$3,10,10,'completed',clock_timestamp()) returning id",['QUOTA-'+(++receipt),shift.id,master.id]);
 await operator.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total) values($1,$2,1,10,7,10)',[sale.id,product.id]);
 await operator.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',10)",[sale.id]);
 await operator.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,reference_type,reference_id,performed_by) values($1,$2,'sale',-1,7,'sale',$3,$4)",[product.id,warehouse.id,sale.id,master.id]);
 return sale;
}
async function protectedState(){const state={};for(const table of ['products','product_options','product_barcodes','users','stock_movements','sales','sale_items','payments','cashier_shifts','sales_orders','sales_order_items','desktop_order_inbox','desktop_sync_outbox','finance_transactions','supplier_payments'])state[table]=await operator.unsafe('select * from public.'+table+' order by id');return JSON.stringify(state);}
async function policy(){return(await sql.unsafe('select restamarket_control.read_sales_reset_policy($1::uuid) value',[master.id]))[0].value;}
async function session(user,token){await operator.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method,last_seen_at) values($1,$2,now()+interval '1 hour','password',now())",[user.id,createHash('sha256').update(token).digest('hex')]);}
try{
 database=await openLocalDatabase(fixture,process.cwd(),{port:55463});
 operator=postgres(database.url,{max:1,prepare:false,onnotice:()=>{}});pools.add(operator);
 [master]=await operator.unsafe("select id,branch_id from users where role='admin'");[warehouse]=await operator.unsafe('select id from warehouses limit 1');
 await operator.unsafe("update users set password_hash='quota-fixture-only-password-marker' where id=$1",[master.id]);
 [other]=await operator.unsafe("insert into users(full_name,role,branch_id,password_hash) values('Other fixture administrator','admin',$1,'quota-fixture-only-password-marker') returning id",[master.branch_id]);
 await session(master,'quota-master');await session(other,'quota-other');
 await operator.unsafe('create role "'+applicationRole+'" login password \''+fixturePassword+'\' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls');
 await operator.unsafe('grant usage on schema public to "'+applicationRole+'"');
 await operator.unsafe('grant select,insert,update,delete on all tables in schema public to "'+applicationRole+'"');
 await operator.unsafe('grant usage,select,update on all sequences in schema public to "'+applicationRole+'"');
 applicationUrl=new URL(database.url);applicationUrl.username=applicationRole;applicationUrl.password=fixturePassword;applicationUrl=String(applicationUrl);process.env.DATABASE_URL=applicationUrl;
 sql=postgres(applicationUrl,{max:4,prepare:false,onnotice:()=>{}});pools.add(sql);
 const core=await load('lib/sales-period.ts'),api=await load('app/api/sales-period/route.ts'),snapshots=await load('lib/system-snapshot.ts');
 let response=await api.GET(request());assert.equal(response.status,503,'No application-side master auto-selection');assert.equal((await response.json()).code,'RESET_POLICY_NOT_CONFIGURED');
 const policySql=await readFile('scripts/central-reset-policy.sql','utf8');
 await operator.unsafe("select set_config('restamarket.application_role',$1,false)",[applicationRole]);
 await operator.unsafe(policySql);
 response=await api.GET(request());assert.equal(response.status,503,'Loading functions still does not initialize the master');assert.equal((await response.json()).code,'RESET_POLICY_NOT_CONFIGURED');
 await assert.rejects(sql.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid)',[master.id]),error=>error.code==='42501','Application cannot initialize/replenish quota');
 await operator.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid)',[master.id]);
 assert.deepEqual(await policy(),{master:true,used:0,remaining:3,limit:3,exhausted:false});
 for(const query of ['select * from restamarket_control.sales_reset_policy','update restamarket_control.sales_reset_policy set used_count=0','delete from restamarket_control.sales_reset_ledger','truncate restamarket_control.sales_reset_ledger','create table restamarket_control.untrusted(id int)'])await assert.rejects(sql.unsafe(query),error=>error.code==='42501','Restricted app cannot tamper with the control schema');
 const functions=await operator.unsafe("select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='restamarket_control' order by p.proname");
 assert.equal(functions.length,3);for(const fn of functions){assert.deepEqual(fn.proconfig,['search_path=pg_catalog']);assert.equal(fn.prosecdef,fn.proname!=='initialize_sales_reset_policy');}
 response=await api.GET(request({token:'quota-other'}));assert.equal(response.status,403);let data=await response.json();assert.equal(data.code,'MASTER_REQUIRED');assert.equal(data.resetPolicy.master,false);assert.equal(data.resetPolicy.remaining,3);assert.equal(JSON.stringify(data).includes(master.id),false,'Do not expose the pinned master ID');
 let preview=await(await api.GET(request())).json();
 response=await api.POST(request({method:'POST',native:true,token:'quota-other',body:confirmation(preview)}));assert.equal(response.status,403);assert.equal((await response.json()).code,'MASTER_REQUIRED');
 response=await api.POST(request({method:'POST',native:true,body:confirmation(preview)}));assert.equal(response.status,409,'An empty period cannot consume quota');
 assert.equal((await policy()).used,0);
 [product]=await operator.unsafe("insert into products(sku,name,sale_price,cost_price) values('QUOTA-FIXTURE','Quota fixture product',10,7) returning id");
 await operator.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',100,7,$3)",[product.id,warehouse.id,master.id]);
 [shift]=await operator.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash,expected_cash,actual_cash,closed_at) values($1,$2,0,0,0,clock_timestamp()) returning id',[master.branch_id,master.id]);
 await seedSale();
 preview=await(await api.GET(request())).json();
 // A native-looking request is insufficient on the central service: the real
 // backup module must find an independently verified private server attestation.
 process.env.BIRKASSA_CENTRAL='1';process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN='c'.repeat(64);process.env.BIRKASSA_DATA_DIR=fixture;
 try{response=await api.POST(request({method:'POST',native:true,body:confirmation(preview)}));assert.equal(response.status,409);assert.equal((await response.json()).code,'CENTRAL_BACKUP_REQUIRED');assert.equal((await policy()).used,0,'Missing central backup proof cannot consume quota');}finally{delete process.env.BIRKASSA_CENTRAL;if(previous.access===undefined)delete process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN;else process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN=previous.access;if(previous.dataRoot===undefined)delete process.env.BIRKASSA_DATA_DIR;else process.env.BIRKASSA_DATA_DIR=previous.dataRoot;}
 for(const body of [{...confirmation(preview),confirm:'DELETE'},{...confirmation(preview),backup:{...backup,sha256:'not-a-hash'}}])assert.equal((await api.POST(request({method:'POST',native:true,body}))).status,400);
 assert.equal((await api.POST(request({method:'POST',body:confirmation(preview)}))).status,403,'Browser cannot attest native backup');
 const realNow=Date.now;try{Date.now=()=>realNow()+16*60*1000;assert.equal((await api.POST(request({method:'POST',native:true,body:confirmation(preview)}))).status,409);}finally{Date.now=realNow;}
 const [open]=await operator.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0) returning id',[master.branch_id,master.id]);
 preview=await(await api.GET(request())).json();assert.equal(preview.openShiftCount,1);assert.equal((await api.POST(request({method:'POST',native:true,body:confirmation(preview)}))).status,409);
 await operator.unsafe('update cashier_shifts set closed_at=clock_timestamp() where id=$1',[open.id]);
 preview=await(await api.GET(request())).json();await seedSale();assert.equal((await api.POST(request({method:'POST',native:true,body:confirmation(preview)}))).status,409,'Changed sale invalidates preview without using quota');
 assert.equal((await policy()).used,0);
 const rollback=Error('fixture rollback');
 await assert.rejects(sql.begin(async tx=>{await tx.unsafe('select restamarket_control.consume_sales_reset($1::uuid,$2::uuid,clock_timestamp(),$3::text,$4::text::jsonb)',[master.id,randomUUID(),'Rollback fixture only',JSON.stringify(backup)]);throw rollback;}),error=>error===rollback);
 assert.equal((await policy()).used,0,'Consumption rolls back in the outer transaction');
 await assert.rejects(sql.unsafe('select restamarket_control.consume_sales_reset($1::uuid,$2::uuid,clock_timestamp(),$3::text,$4::text::jsonb)',[other.id,randomUUID(),'Wrong administrator',JSON.stringify(backup)]),error=>error.code==='RM002');
 const oldSnapshot=await snapshots.createSnapshot(sql),beforeFailure=await protectedState();
 await operator.unsafe("create function public.quota_fixture_fail_audit() returns trigger language plpgsql as $$ begin if NEW.action='sales.period_reset' then raise exception 'fixture audit failure'; end if; return NEW; end $$");
 await operator.unsafe('create trigger quota_fixture_fail_audit before insert on public.audit_logs for each row execute function public.quota_fixture_fail_audit()');
 preview=await(await api.GET(request())).json();assert.equal((await api.POST(request({method:'POST',native:true,body:confirmation(preview)}))).status,503);
 assert.equal((await policy()).used,0,'Audit failure rolls back policy consumption and period update');assert.equal(await protectedState(),beforeFailure);
 assert.equal((await operator.unsafe('select count(*)::int n from system_settings where key=$1',[core.salesPeriodKey]))[0].n,0);
 await operator.unsafe('drop trigger quota_fixture_fail_audit on public.audit_logs');await operator.unsafe('drop function public.quota_fixture_fail_audit()');
 for(let expected=1;expected<=2;expected++){
  if(expected>1)await seedSale();preview=await(await api.GET(request())).json();const before=await protectedState(),body=confirmation(preview);
  response=await api.POST(request({method:'POST',native:true,body}));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));data=await response.json();
  assert.deepEqual(data.resetPolicy,{master:true,used:expected,remaining:3-expected,limit:3,exhausted:false});assert.equal(await protectedState(),before,'Period reset must not mutate receipts, stock, payments, users or financial rows');
  assert.equal((await api.POST(request({method:'POST',native:true,body}))).status,409,'Replayed confirmation does not consume another use');assert.equal((await policy()).used,expected);
 }
 await seedSale();preview=await(await api.GET(request())).json();const beforeRace=await protectedState();
 const race=await Promise.all([api.POST(request({method:'POST',native:true,body:confirmation(preview)})),api.POST(request({method:'POST',native:true,body:confirmation(preview)}))]);
 assert.deepEqual(race.map(result=>result.status).sort(),[200,403],'At two uses, simultaneous resets can consume exactly one final use');
 const rejected=await race.find(result=>result.status===403).json();assert.equal(rejected.code,'RESET_LIMIT_EXHAUSTED');assert.equal(rejected.resetPolicy.remaining,0);
 assert.deepEqual(await policy(),{master:true,used:3,remaining:0,limit:3,exhausted:true});assert.equal(await protectedState(),beforeRace);
 assert.equal((await operator.unsafe('select count(*)::int n from restamarket_control.sales_reset_ledger'))[0].n,3);
 assert.equal((await operator.unsafe("select count(*)::int n from public.audit_logs where action='sales.period_reset'"))[0].n,3);
 preview=await(await api.GET(request())).json();assert.equal(preview.resetPolicy.exhausted,true,'Exhausted master can still inspect permanent status');
 response=await api.POST(request({method:'POST',native:true,body:confirmation(preview)}));assert.equal(response.status,403);assert.equal((await response.json()).code,'RESET_LIMIT_EXHAUSTED');
 await assert.rejects(sql.unsafe('select restamarket_control.consume_sales_reset($1::uuid,$2::uuid,clock_timestamp(),$3::text,$4::text::jsonb)',[master.id,randomUUID(),'Direct fourth SQL attempt',JSON.stringify(backup)]),error=>error.code==='RM003','Database itself rejects a fourth consumption without relying on Node or UI');
 await operator.unsafe(policySql);await operator.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid)',[master.id]);assert.equal((await policy()).used,3,'Re-running provisioning cannot replenish quota');
 await assert.rejects(operator.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid)',[other.id]),error=>error.code==='RM002','Operator helper cannot silently change pinned master');
 await sql.unsafe("insert into system_settings(key,value) values('sales_reset_used_count','0') on conflict(key) do update set value='0'");assert.equal((await policy()).used,3,'Public editable settings are not the quota authority');
 const [last]=await operator.unsafe('delete from restamarket_control.sales_reset_ledger where ordinal=3 returning *');
 response=await api.GET(request());assert.equal(response.status,503);assert.equal((await response.json()).code,'RESET_POLICY_INVALID','Ledger/counter disagreement fails closed');
 await operator.unsafe('insert into restamarket_control.sales_reset_ledger select * from jsonb_populate_record(null::restamarket_control.sales_reset_ledger,$1::text::jsonb)',[JSON.stringify(last)]);
 // A genuine old application snapshot contains public tables only. It may rewind
 // reporting data and public audits, but the lifetime policy/ledger must survive.
 await snapshots.restoreSnapshot(sql,oldSnapshot,master.id,randomUUID());await session(master,'quota-master');
 assert.equal((await policy()).used,3,'Application-table restore cannot rewind control-schema quota');
 preview=await(await api.GET(request())).json();assert.equal(preview.resetPolicy.remaining,0);assert.ok(preview.sales.receipts>0,'Old restored receipts do not re-enable reset');
 response=await api.POST(request({method:'POST',native:true,body:confirmation(preview)}));assert.equal(response.status,403);assert.equal((await response.json()).code,'RESET_LIMIT_EXHAUSTED');
 // Explicit operator-only legacy import is also tested inside a rolled-back
 // fixture transaction; the permanent three-use state above is never altered.
 await assert.rejects(operator.begin(async tx=>{
  await tx.unsafe('delete from restamarket_control.sales_reset_ledger');await tx.unsafe('delete from restamarket_control.sales_reset_policy');await tx.unsafe("delete from public.audit_logs where action='sales.period_reset'");
  for(let index=0;index<2;index++)await tx.unsafe("insert into public.audit_logs(user_id,action,entity_type,entity_id) values($1,'sales.period_reset','sales_period',$2)",[master.id,randomUUID()]);
  const [initialized]=await tx.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid) value',[master.id]);assert.equal(initialized.value.used,2,'Successful legacy resets are counted, not replenished');
  assert.equal((await tx.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid) value',[master.id]))[0].value.used,2);
  throw rollback;
 }),error=>error===rollback);
 assert.equal((await policy()).used,3);
 console.log('PASS: isolated restricted-role central quota, explicit pinned master, protected SECURITY DEFINER functions, 3-use lifetime cap, final-use concurrency, failed/stale/open/rollback zero consumption, audit atomicity, rerun persistence, corrupt-policy fail closed and application restore cannot replenish; no real data or server accessed.');
}finally{
 for(const pool of pools)await pool.end({timeout:2});if(database)await database.close();
 for(const [key,value]of Object.entries({BIRKASSA_LOCAL:previous.local,BIRKASSA_DESKTOP_TOKEN:previous.token,DATABASE_URL:previous.url,BIRKASSA_PG_BIN:previous.bin,BIRKASSA_CENTRAL:previous.central,BIRKASSA_DESKTOP_ACCESS_TOKEN:previous.access,BIRKASSA_DATA_DIR:previous.dataRoot}))if(value===undefined)delete process.env[key];else process.env[key]=value;
}
