import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Actual route handlers with an isolated transactional SQL adapter. No server,
// database, SMTP connection or real customer/order is touched.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const compiledModule={exports:{}},fixtureConsole={...console,error:(...args)=>{if(args[0]==='orders.post'&&args[1]?.statusCode>=400&&args[1]?.statusCode<500)return;console.error(...args);}};
 new Function('require','module','exports','console',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports,fixtureConsole);return compiledModule.exports;
}
const cancellation=await load('lib/order-cancellation.ts');
const reason='Seçilən məhsul hazırda stokda yoxdur.';
for(const value of [undefined,null,1,'','    ','123456','aaaaaa','test123','asdf','<script>stok</script>','x'.repeat(501),'səbəb\u0000yoxdur'])assert.equal(cancellation.isOrderCancellationReason(value),false,String(value));
for(const value of [reason,'  Stok\n yoxdur.  ','Товар отсутствует на складе.','The item is no longer available.','Seçilen ürün stokta yok.','所选商品目前缺货。'])assert.equal(cancellation.isOrderCancellationReason(value),true,value);
assert.equal(cancellation.normalizeOrderCancellationReason(' Stok\n  yoxdur. '),'Stok yoxdur.');
const id='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',accountId='30000000-0000-4000-8000-000000000001';
let role='admin',customer=accountId,row,writes,audits,emails,events,paid,failAudit,failEmail,queryLog,tail=Promise.resolve();
function reset(extra={}){row={id,order_no:'1501',source:'catalog',account_id:accountId,status:'pending',fulfillment:'pickup',delivery_stage:'received',cancellation_reason:null,cancelled_at:null,...extra};writes=0;audits=[];emails=[];events=[];queryLog=[];paid=false;failAudit=false;failEmail=false;role='admin';customer=accountId;}
reset();
const sql={async unsafe(query,args=[]){
 queryLog.push({query,args});
 if(query.startsWith('select id from users'))return [{id:actor}];
 if(query.startsWith('select id,order_no,status')){assert.match(query,/for update/);return args[0]===row.id?[{...row}]:[];}
 if(query.startsWith('select id from sales where sales_order_id='))return paid?[{id:'paid-fixture'}]:[];
 if(query.startsWith('select email from customer_accounts')){assert.equal(args[0],row.account_id);return [{email:'stored-customer@example.test'}];}
 if(query.startsWith('update sales_orders set status=')){
  writes++;const status=args[0];row.status=['cancelled','completed'].includes(status)?status:['ready','dispatched','delivered'].includes(status)?'ready':row.status;
  if(!['cancelled','completed'].includes(status))row.delivery_stage=status;
  if(status==='cancelled'){row.cancellation_reason=args[2];row.cancelled_at='2026-11-08T12:00:00.000Z';}
  return [];
 }
 if(query.startsWith('insert into audit_logs')){if(failAudit)throw Error('fixture audit failure');audits.push(JSON.parse(args[3]));return [];}
 if(query.startsWith('select o.order_no,o.status')){assert.match(query,/where o.account_id=\$1/);return args[0]===row.account_id?[{...row}]:[];}
 if(query.startsWith('select count(*)::int total'))return [{total:1,active:0,completed:0}];
 if(query.startsWith('select o.id,o.order_no,o.status'))return [{...row}];
 throw Error('Unexpected fixture SQL: '+query);
 },async begin(callback){
  const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
  const before={...row},oldWrites=writes,oldAudits=[...audits];events.push('begin');
  try{const value=await callback(sql);events.push('commit');return value;}catch(error){row=before;writes=oldWrites;audits=oldAudits;events.push('rollback');throw error;}finally{release();}
 },async end(){}};
const authDb={async unsafe(){return role?[{id:actor,role}]:[];},async end(){}};
const access=await load('lib/staff-access.ts'),security=await load('lib/admin-security.ts');
const auth=await load('lib/require-admin.ts',{'server-only':{},'@/lib/store-db':{storeDb:()=>authDb},'@/lib/admin-security':security,'@/lib/staff-access':access});
const mail={async notifyCustomerEmail(message){assert(events.includes('commit'),'Email must only run after a committed transaction');assert.equal(row.status,'cancelled');emails.push(message);if(failEmail)throw Error('fixture SMTP failure');}};
const common={'@/lib/require-admin':auth,'@/lib/order-cancellation':cancellation,'@/lib/smtp-mail':mail};
const online=await load('app/api/online-orders/route.ts',{...common,'@/lib/store-db':{storeDb:()=>sql}});
const oldDatabase=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://isolated.invalid/cancellation-fixture';
const pos=await load('app/api/orders/route.ts',{...common,'next/server':{NextResponse:Response},'@/lib/product-options':{optionSnapshot:()=>''},'@/lib/log-error':{logSystemError:async()=>{}},'@/lib/warehouse':{salesWarehouseSql:()=>''},'@/lib/commerce':{sellingPrice:()=>0},postgres:()=>sql});
function request(path,body,{cookie=true,origin='https://fixture.example'}={}){return new Request('https://fixture.example'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:'birkassa_session=fixture-token'}:{}),'x-birkassa-role':'admin','x-birkassa-user-id':actor},body:JSON.stringify(body)});}
function cancel(body={},options){const req=request('/api/online-orders',{id,status:'cancelled',cancellationReason:reason,...body},options);return online.PATCH(new Request(req,{method:'PATCH'}));}
function posCancel(body={},options){return pos.POST(request('/api/orders',{action:'status',orderId:id,status:'cancelled',...body},options));}
try{
 reset();assert.equal((await cancel({}, {cookie:false})).status,401);assert.equal(writes,0,'Forged identity headers cannot authorize cancellation');
 assert.equal((await cancel({}, {origin:'https://attacker.example'})).status,403);assert.equal(writes,0);
 role='online_assistant';assert.equal((await cancel()).status,403);assert.equal(writes,0);
 role='accountant';assert.equal((await cancel()).status,403);assert.equal(writes,0);
 role='admin';
 for(const value of [undefined,'','123456','aaaaaa','test123','x'.repeat(501)]){assert.equal((await cancel({cancellationReason:value})).status,400);assert.equal(writes,0);}
 role='online_manager';assert.equal((await cancel({cancellationReason:'  '+reason+'\n ',to:'attacker@example.test'})).status,200);
 assert.equal(row.cancellation_reason,reason);assert.ok(row.cancelled_at);assert.equal(writes,1);assert.equal(audits.length,1);assert.equal(audits[0].cancellationReason,reason);
 assert.equal(emails.length,1);assert.equal(emails[0].eventKey,'order-cancelled:'+id);assert.equal(emails[0].to,'stored-customer@example.test');assert.ok(emails[0].text.includes(reason));assert.ok(emails[0].text.includes('1501'));
 assert.equal((await cancel()).status,200);assert.equal(writes,1);assert.equal(audits.length,1);assert.equal(emails.length,1,'Idempotent cancellation replay must not notify again');
 assert.equal((await cancel({cancellationReason:'Məhsul artıq istehsal olunmur.'})).status,409);assert.equal(row.cancellation_reason,reason);assert.equal(emails.length,1);
 reset({status:'cancelled',cancellation_reason:null});assert.equal((await cancel()).status,409);assert.equal(row.cancellation_reason,null);assert.equal(writes,0,'Never fabricate a reason for historical cancellations');
 reset();paid=true;assert.equal((await cancel()).status,409);assert.equal(writes,0);assert.equal(emails.length,0);
 reset();failAudit=true;await assert.rejects(()=>cancel(),/fixture audit failure/);assert.equal(row.status,'pending');assert.equal(row.cancellation_reason,null);assert.equal(emails.length,0,'A rolled-back cancellation cannot send an email');
 reset();failEmail=true;assert.equal((await cancel()).status,200);assert.equal(row.status,'cancelled');assert.equal(row.cancellation_reason,reason,'SMTP failure cannot undo committed cancellation');
 reset({account_id:null});assert.equal((await cancel()).status,200);assert.equal(emails.length,0,'Guest/unlinked order must not use a request-supplied recipient');
 reset();const concurrent=await Promise.all([cancel(),cancel()]);assert.deepEqual(concurrent.map(r=>r.status),[200,200]);assert.equal(writes,1);assert.equal(audits.length,1);assert.equal(emails.length,1,'Row lock + immutable reason allow only one fresh concurrent cancellation');
 reset();assert.equal((await online.PATCH(new Request(request('/api/online-orders',{id,status:'preparing'}),{method:'PATCH'}))).status,200);assert.equal(row.status,'pending');assert.equal(row.delivery_stage,'preparing');assert.equal(row.cancellation_reason,null);assert.equal(emails.length,0,'Ordinary fulfillment updates need no cancellation reason');
 reset();assert.equal((await posCancel()).status,400);assert.equal(writes,0,'POS cannot bypass the catalog cancellation reason');
 role='manager';assert.equal((await posCancel({cancellationReason:reason,to:'attacker@example.test'})).status,201);assert.equal(row.cancellation_reason,reason);assert.equal(emails.length,1);assert.equal(emails[0].to,'stored-customer@example.test');
 assert.equal((await posCancel({cancellationReason:reason})).status,201);assert.equal(writes,1);assert.equal(emails.length,1);
 assert.equal((await posCancel({cancellationReason:'Sifarişin məhsulu mövcud deyil.'})).status,409);assert.equal(row.cancellation_reason,reason);
 reset();paid=true;assert.equal((await posCancel({cancellationReason:reason})).status,409);assert.equal(writes,0);
 reset({source:'pos',account_id:null});assert.equal((await posCancel()).status,201);assert.equal(row.cancellation_reason,null);assert.equal(emails.length,0,'Noncatalog POS cancellation remains compatible');
 reset();failEmail=true;assert.equal((await posCancel({cancellationReason:reason})).status,201);assert.equal(row.status,'cancelled');
 reset();role='warehouse';assert.equal((await posCancel({cancellationReason:reason})).status,403);assert.equal(writes,0);
}finally{if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;}

const myOrders=await load('app/api/my-orders/route.ts',{'@/lib/store-db':{storeDb:()=>sql},'@/lib/customer-session':{customerAccount:async()=>customer?{id:customer}:null}});
reset({status:'cancelled',cancellation_reason:reason});
let response=await myOrders.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal((await response.json()).orders[0].cancellation_reason,reason);
customer='40000000-0000-4000-8000-000000000001';response=await myOrders.GET();assert.deepEqual((await response.json()).orders,[],'Another account cannot see the cancellation reason');
customer=null;const before=queryLog.length;assert.equal((await myOrders.GET()).status,401);assert.equal(queryLog.length,before);
const language={useTranslations:()=>({t:value=>value,languageLocale:()=> 'az-AZ',languageAmount:value=>value.toFixed(2)})};
const {OrderList}=await load('app/account/order-list.tsx',{'@/lib/language':language,'next/link':({children,href,...props})=>createElement('a',{href,...props},children)});
const baseOrder={...row,total:'10.00',created_at:'2026-11-08T10:00:00Z',items:[],fulfillment:'pickup'};
const render=reason=>renderToStaticMarkup(createElement(OrderList,{orders:[{...baseOrder,status:'cancelled',cancellation_reason:reason}],onRefresh(){},unavailable:false,refreshing:false}));
assert.ok(render(reason).includes(reason));assert.ok(render(null).includes('Bu köhnə sifariş üçün ləğv səbəbi qeyd edilməyib.'));
const unsafe=render('<script>alert("fixture")</script>');assert(!unsafe.includes('<script>'));assert.ok(unsafe.includes('&lt;script&gt;'),'Untrusted stored reasons render as text, never HTML');
for(const [status,label]of [['cancelled','Ləğv edilib'],['completed','Tamamlandı'],['pending','Qəbul edildi']]){
 let stateIndex=0;const fixture={...baseOrder,id,order_no:'UI-CARE-CANCEL',status,delivery_stage:'received',cancellation_reason:reason,full_name:'Fixture customer',phone:''};
 const react={...require('react'),useEffect:()=>{},useState:initial=>[stateIndex++===0?[fixture]:stateIndex===2?status:initial,()=>{}]};
 const {default:OnlineOrders}=await load('app/admin/online/online-page.tsx',{'react':react,'@/lib/language':language,'@/lib/staff-portal':{staffPortalPath:()=>'/fixture-staff'},'@/lib/use-admin-activity':{useAdminActivity:()=>{}},'@/components/ui/button':{Button:({children,...props})=>createElement('button',props,children)},'./order-cancel-dialog':()=>null,'../store/store-admin.css':{}});
 const html=renderToStaticMarkup(createElement(OnlineOrders));assert.ok(html.includes('<p>'+label+'</p>'),'Actual online card terminal status must override retained fulfillment stage: '+status);
 if(status!=='pending')assert.ok(!html.includes('<p>Qəbul edildi</p>'),'Terminal order must not appear received');
}
const dialog=await readFile('app/admin/online/order-cancel-dialog.tsx','utf8');assert.ok(dialog.includes('isOrderCancellationReason(reason)'));assert.ok(dialog.includes('cancellationReason:normalizeOrderCancellationReason(reason)'));assert.ok(dialog.includes('pending.current'));assert.ok(dialog.includes('<textarea'));assert.ok(dialog.includes('minLength={5}'));assert.ok(!dialog.includes('window.confirm'));
for(const path of ['app/admin/online/online-page.tsx','app/admin/staff-dashboard.tsx'])assert.ok((await readFile(path,'utf8')).includes('<OrderCancelDialog'),path);
const translations=(await load('lib/order-cancellation-translations.ts')).orderCancellationTranslations;assert.ok(translations.length>=12);for(const row of translations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));}
const migration=await readFile('drizzle/0033_order_cancellation.sql','utf8');assert.match(migration,/ADD COLUMN cancellation_reason text/);assert.match(migration,/ADD COLUMN cancelled_at timestamptz/);assert.ok(!/\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(migration),'Additive nullable columns preserve historical orders');
console.log('PASS: authenticated cancellation reason, both store/POS paths, immutable idempotent retries, paid/race/rollback guards, post-commit stored-recipient SMTP hooks, private customer DTO, safe reason UI, legacy null compatibility and 5-language content. No live data or SMTP used.');
