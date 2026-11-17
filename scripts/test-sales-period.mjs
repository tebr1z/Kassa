import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// Fresh isolated PostgreSQL only. Never read the installed profile or real keys.
const previous={local:process.env.BIRKASSA_LOCAL,token:process.env.BIRKASSA_DESKTOP_TOKEN,url:process.env.DATABASE_URL,bin:process.env.BIRKASSA_PG_BIN};
const fixture=path.resolve('.local-desktop-data','sales-period-'+randomUUID()),secret='sales-period-fixture-'+randomUUID();
process.env.BIRKASSA_LOCAL='1';process.env.BIRKASSA_DESKTOP_TOKEN=secret;process.env.BIRKASSA_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const require=createRequire(import.meta.url),modules=new Map(),pools=new Set();let database,sql;
async function load(file){
 if(modules.has(file))return modules.get(file);
 const source=await readFile(file,'utf8'),m={exports:{}},mocks={'server-only':{},'@/lib/log-error':{logSystemError:async()=>{}},'@/lib/store-db':{storeDb:()=>{const pool=postgres(database.url,{max:1,prepare:false,onnotice:()=>{}});pools.add(pool);return pool;}}};
 for(const [,name]of source.matchAll(/from\s*['"](@\/[^'"]+)['"]/g))if(!Object.hasOwn(mocks,name))mocks[name]=await load(name.replace('@/','')+'.ts');
 const compiled=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),m,m.exports);modules.set(file,m.exports);return m.exports;
}
let admin,warehouse,product,linkedOrder;
const backup={fileName:'before-sales-period-fixture.birkassa',sha256:'a'.repeat(64),bytes:1024};
function request(endpoint,{method='GET',token='admin-fixture',native=false,body,headers={}}={}){
 return new Request('http://127.0.0.1:5760/api/'+endpoint,{method,headers:{...(token?{cookie:'birkassa_session='+token}:{}),...(native?{authorization:'Bearer '+secret}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
}
async function protectedState(){const state={};for(const table of ['products','product_options','product_barcodes','users','stock_movements','sales','sale_items','payments','cashier_shifts','sales_orders','sales_order_items','desktop_order_inbox','desktop_sync_outbox','finance_transactions','supplier_payments'])state[table]=await sql.unsafe('select * from '+table+' order by id');return JSON.stringify(state);}
async function seedSale(receipt,status='completed',order=null){
 const [shift]=await sql.unsafe('select id from cashier_shifts order by id limit 1');
 const [sale]=await sql.unsafe('insert into sales(receipt_no,shift_id,cashier_id,sales_order_id,subtotal,total,status) values($1,$2,$3,$4,10,10,$5) returning id',[receipt,shift.id,admin.id,order,status]);
 await sql.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total) values($1,$2,1,10,7,10)',[sale.id,product.id]);
 await sql.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',10)",[sale.id]);
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,reference_type,reference_id,performed_by) values($1,$2,'sale',-1,7,'sale',$3,$4)",[product.id,warehouse.id,sale.id,admin.id]);
 if(status==='returned')await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,reference_type,reference_id,performed_by) values($1,$2,'return',1,7,'sale_return',$3,$4)",[product.id,warehouse.id,sale.id,admin.id]);
 return sale;
}
try{
 database=await openLocalDatabase(fixture,process.cwd(),{port:55459});process.env.DATABASE_URL=database.url;
 sql=postgres(database.url,{max:5,prepare:false,onnotice:()=>{}});pools.add(sql);
 [admin]=await sql.unsafe("select id,branch_id from users where role='admin'");[warehouse]=await sql.unsafe('select id from warehouses limit 1');
 await sql.unsafe("update users set password_hash='fixture-only-password-marker' where id=$1",[admin.id]);
 const roles=['admin','cashier','warehouse','accountant','manager'];
 for(const role of roles){
  const user=role==='admin'?admin:(await sql.unsafe("insert into users(full_name,role,branch_id,password_hash) values($1,$2,$3,'fixture-only-password-marker') returning id",['Fixture '+role,role,admin.branch_id]))[0];
  await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method,last_seen_at) values($1,$2,now()+interval '1 hour','password',now())",[user.id,createHash('sha256').update(role+'-fixture').digest('hex')]);
 }
 [product]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('PERIOD-FIXTURE','Dövr sınaq məhsulu',10,7) returning id");
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',100,7,$3)",[product.id,warehouse.id,admin.id]);
 await sql.unsafe("insert into cashier_shifts(branch_id,cashier_id,opening_cash,expected_cash,actual_cash,closed_at) values($1,$2,5,35,35,now())",[admin.branch_id,admin.id]);
 const [customer]=await sql.unsafe("insert into customers(full_name) values('Fixture customer') returning id");
 [linkedOrder]=await sql.unsafe("insert into sales_orders(order_no,customer_id,total,created_by,status,source) values('PERIOD-WEB-ORDER',$1,10,$2,'completed','catalog') returning id",[customer.id,admin.id]);
 await sql.unsafe('insert into sales_order_items(sales_order_id,product_id,quantity,unit_price,line_total) values($1,$2,1,10,10)',[linkedOrder.id,product.id]);
 await sql.unsafe("insert into desktop_order_inbox(store_url,remote_id,payload,local_order_id) values('https://period-fixture.invalid',$1,'{}',$2)",[randomUUID(),linkedOrder.id]);
 await seedSale('#000001');await seedSale('#000002','returned');await seedSale('#000003','completed',linkedOrder.id);
 await sql.unsafe("insert into finance_transactions(type,category,description,amount,created_by) values('expense','Digər','Saxlanılacaq xərc',25,$1)",[admin.id]);
 const core=await load('lib/sales-period.ts'),api=await load('app/api/sales-period/route.ts'),dashboard=await load('app/api/dashboard/route.ts'),reports=await load('app/api/reports/route.ts'),finance=await load('app/api/finance/route.ts'),sales=await load('app/api/sales/route.ts');
 assert.match(await readFile('app/api/sales/route.ts','utf8'),/insert into sales \([^\n]+created_at\) values \([^\n]+clock_timestamp\(\)\)/,'A transaction started before the boundary must use actual receipt posting time');
 assert.equal(core.salesPeriodPredicate({startedAt:null,resetId:null}),'true');assert.throws(()=>core.salesPeriodPredicate({startedAt:"');delete from sales;--",resetId:null}));
 const first=await (await api.GET(request('sales-period'))).json();assert.equal(first.sales.receipts,3);assert.equal(first.sales.completed,2);assert.equal(first.sales.returned,1);assert.equal(first.sales.total,20);assert.equal(first.openShiftCount,0);
 const body=()=>({confirm:'YENİ DÖVR',reason:'İzolyasiya olunmuş sınaq dövrü',preview:first.preview,backup});
 assert.equal((await api.POST(request('sales-period',{method:'POST',body:body()}))).status,403,'Browser cannot attest a native verified backup');
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,headers:{authorization:'Bearer '+secret+'x'},body:body()}))).status,403,'Incorrect native token fails closed');
 for(const role of ['cashier','warehouse','accountant','manager'])assert.equal((await api.GET(request('sales-period',{token:role+'-fixture'}))).status,403,role+' cannot reset/preview');
 assert.equal((await api.POST(request('sales-period',{method:'POST',token:null,native:true,headers:{'x-birkassa-role':'admin','x-birkassa-user-id':admin.id},body:body()}))).status,401,'Identity headers cannot forge a session');
 process.env.BIRKASSA_LOCAL='0';assert.ok([403,404].includes((await api.GET(request('sales-period'))).status));process.env.BIRKASSA_LOCAL='1';
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:{...body(),backup:{...backup,fileName:'../bad.birkassa'}}}))).status,400);
 const realNow=Date.now;try{Date.now=()=>realNow()+16*60*1000;assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:body()}))).status,409,'Expired confirmation rejected');}finally{Date.now=realNow;}
 const [opened]=await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0) returning id',[admin.branch_id,admin.id]);
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:body()}))).status,409,'Changed preview rejected');
 let preview=await (await api.GET(request('sales-period'))).json();assert.equal(preview.openShiftCount,1);
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:{...body(),preview:preview.preview}}))).status,409,'Open shift blocks reset');
 await sql.unsafe('update cashier_shifts set closed_at=now() where id=$1',[opened.id]);
 preview=await (await api.GET(request('sales-period'))).json();await seedSale('#000004');
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:{...body(),preview:preview.preview}}))).status,409,'New sale invalidates preview/backup');
 preview=await (await api.GET(request('sales-period'))).json();const before=await protectedState();
 const archive=path.join(fixture,'backups',backup.fileName);await database.backupForUpdate(archive);backup.sha256=createHash('sha256').update(await readFile(archive)).digest('hex');backup.bytes=(await stat(archive)).size;
 const response=await api.POST(request('sales-period',{method:'POST',native:true,body:{...body(),preview:preview.preview}}));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const reset=await response.json();assert.equal(reset.archivedReceipts,4);assert.ok(reset.currentPeriod.startedAt);
 assert.equal(await protectedState(),before,'Receipts, stock, costs, prices, employees, financial rows and sync links unchanged');
 assert.equal((await sql.unsafe("select count(*)::int n from audit_logs where action='sales.period_reset'"))[0].n,1);
 assert.equal((await sql.unsafe("select count(*)::int n from sales where sales_order_id=$1 and status='completed'",[linkedOrder.id]))[0].n,1,'Paid-order protection remains true');
 assert.equal((await api.POST(request('sales-period',{method:'POST',native:true,body:{...body(),preview:preview.preview}}))).status,409,'Retry cannot start a second period');
 const currentDashboard=await (await dashboard.GET(request('dashboard'))).json(),allDashboard=await (await dashboard.GET(request('dashboard?scope=all'))).json();
 assert.equal(currentDashboard.today.total,0);assert.equal(currentDashboard.recent.length,0);assert.equal(allDashboard.today.total,30);assert.equal(allDashboard.recent.length,4);
 const currentReports=await (await reports.GET(request('reports'))).json(),allReports=await (await reports.GET(request('reports?scope=all'))).json();
 assert.equal(currentReports.summary.sales,0);assert.equal(currentReports.summary.returns,0);assert.equal(allReports.summary.sales,30);assert.equal(allReports.summary.returns,1);assert.equal(currentReports.products.length,0);
 const currentFinance=await (await finance.GET(request('finance'))).json(),allFinance=await (await finance.GET(request('finance?scope=all'))).json();
 assert.equal(currentFinance.metrics.revenue,0);assert.equal(currentFinance.sales.length,0);assert.equal(currentFinance.metrics.expenses,25);assert.equal(currentFinance.metrics.netProfit,-25);assert.equal(allFinance.metrics.revenue,30);assert.equal(currentFinance.salesPeriod.financialExpensesPreserved,true);
 assert.equal((await api.GET(request('sales-period')).then(r=>r.json())).archive.receipts,4);
 const [nextShift]=await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0) returning id',[admin.branch_id,admin.id]);
 const next=await sales.POST(request('sales',{method:'POST',body:{items:[{productId:product.id,quantity:1}],paymentMethod:'cash'}}));assert.equal(next.status,201,JSON.stringify(await next.clone().json()));assert.equal((await next.json()).receiptNo,'#000005','Receipt numbers never restart');
 assert.equal((await dashboard.GET(request('dashboard')).then(r=>r.json())).today.total,10,'Post-reset sale belongs to new period');
 // A sale waiting for a concurrently closing shift must recheck its open state.
 let heldResolve,releaseResolve;const held=new Promise(resolve=>heldResolve=resolve),release=new Promise(resolve=>releaseResolve=resolve);
 const closer=sql.begin(async tx=>{await tx.unsafe('select id from cashier_shifts where id=$1 for update',[nextShift.id]);heldResolve();await release;await tx.unsafe('update cashier_shifts set closed_at=clock_timestamp() where id=$1',[nextShift.id]);});await held;
 const waitingSale=sales.POST(request('sales',{method:'POST',body:{items:[{productId:product.id,quantity:1}],paymentMethod:'cash'}}));
 let waiting=false;for(let attempt=0;attempt<200&&!waiting;attempt++){waiting=(await sql.unsafe("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select id,branch_id from cashier_shifts%') waiting"))[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}
 releaseResolve();await closer;assert.equal(waiting,true,'Sale reached row lock before shift close');assert.equal((await waitingSale).status,409,'Closed shift cannot accept a straddling sale');
 assert.equal((await sql.unsafe('select count(*)::int n from sales'))[0].n,5);
 console.log('PASS: isolated sales-period reset, real session/native authorization, stale preview/open shifts, verified archive, all/current reporting, protected stock/products/users/finance/sync data, paid-order guards, monotonic receipts and shift-close/sale race; no real data touched.');
}finally{
 if(sql)await sql.end({timeout:2});for(const pool of pools)await pool.end({timeout:2});if(database)await database.close();
 for(const [key,value]of Object.entries({BIRKASSA_LOCAL:previous.local,BIRKASSA_DESKTOP_TOKEN:previous.token,DATABASE_URL:previous.url,BIRKASSA_PG_BIN:previous.bin}))if(value===undefined)delete process.env[key];else process.env[key]=value;
}
