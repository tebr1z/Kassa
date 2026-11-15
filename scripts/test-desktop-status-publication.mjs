import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';

// Execute the real receiver, cancellation validator and strict wire schema.
// SQL, SMTP and catalogue application are in-memory; no DB/network/profile.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const compiled=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],file);
 const result={exports:{}};
 new Function('require','module','exports',compiled.outputText)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),result,result.exports);
 return result.exports;
}
const delta=await load('lib/desktop-catalog-delta.ts'),images=await load('lib/product-option-image.ts');
const cancellation=await load('lib/order-cancellation.ts'),outbound=await load('lib/desktop-outbound-conflicts.ts');
const clientId=randomUUID(),actor={userId:randomUUID()},time='2026-11-15 10:00:00.123456+00';
let smtpCalls=0,catalogCalls=0;
const receiver=await load('lib/desktop-bridge.ts',{
 '@/lib/desktop-sync':{feedKeyName:'desktop_order_feed_key_hash',isDesktop:()=>false,matchesKey:()=>false,readSyncConfig:async()=>null},
 '@/lib/desktop-media':{cachedMedia:async()=>{throw Error('No media reads in status receiver test');}},
 '@/lib/store-db':{storeDb:()=>{throw Error('No real SQL factory in status receiver test');}},
 '@/lib/product-option-image':images,'@/lib/desktop-catalog-delta':delta,'@/lib/desktop-outbound-conflicts':outbound,
 '@/lib/desktop-catalog-source':{readDesktopPublicProducts:async()=>{throw Error('No private product reads in status receiver test');}},
 '@/lib/desktop-catalog-apply':{applyPublicProduct:async(_sql,product)=>{catalogCalls++;assert.equal(product.name,'Açıq kataloq məhsulu');return true;}},
 '@/lib/order-cancellation':cancellation,
 '@/lib/smtp-mail':{async notifyCustomerEmail(){smtpCalls++;throw Error('Unexpected SMTP call for account_id=null');}},
});
function order(overrides={}){return {id:randomUUID(),order_no:'1501',account_id:null,status:'ready',fulfillment:'delivery',delivery_stage:'ready',cancellation_reason:null,cancelled_at:null,updated_at:time,...overrides};}
function fixture(initial=[]){
 const state={orders:new Map(initial.map(row=>[row.id,structuredClone(row)])),settings:new Map(),paid:new Set(),writes:[],audits:[],queries:[],commits:0};
 const sql={
  async begin(callback){
   const before={orders:structuredClone(state.orders),settings:structuredClone(state.settings),writes:structuredClone(state.writes),audits:structuredClone(state.audits)};
   try{const value=await callback(sql);state.commits++;return value;}catch(error){Object.assign(state,before);throw error;}
  },
  async unsafe(query,params=[]){
   state.queries.push(query);
   if(query.startsWith('select pg_advisory_xact_lock'))return [];
   if(query.startsWith('select key,value from system_settings'))return [...state.settings].map(([key,value])=>({key,value}));
   if(query.startsWith('select id,order_no,account_id,status,fulfillment,delivery_stage,cancellation_reason,updated_at::text')){const found=state.orders.get(params[0]);return found?[structuredClone(found)]:[];}
   if(query.startsWith("select id from sales where sales_order_id=$1 and status='completed'"))return state.paid.has(params[0])?[{id:randomUUID()}]:[];
   if(query.startsWith('update sales_orders set status=')){
    const [status,delivery_stage,id,reason]=params,row=state.orders.get(id);assert.ok(row);row.status=status;row.delivery_stage=delivery_stage;row.updated_at='2026-11-15 10:01:00.000001+00';
    if(status==='cancelled'){row.cancellation_reason=reason;row.cancelled_at='2026-11-15T10:01:00.000Z';}
    state.writes.push({id,status,delivery_stage,reason});return [];
   }
   if(query.startsWith('insert into audit_logs')){assert.equal(params[0],actor.userId);state.audits.push({id:params[1],after:JSON.parse(params[2])});return [];}
   if(query.startsWith('insert into system_settings')){state.settings.set(params[0],params[1]);return [];}
   if(query.startsWith('select email from customer_accounts'))throw Error('No account credentials/contact lookup when account_id is null');
   throw Error('Unexpected mocked receiver query: '+query);
  },
 };
 return {sql,state};
}
const publicProduct={id:randomUUID(),sku:'STATUS-QA',name:'Açıq kataloq məhsulu',code:'123456',category:'Sınaq',unit:'ədəd',price:12,discountPrice:null,image:'',images:[],options:[],isActive:true};
function status(row,overrides={}){return {id:row.id,status:'cancelled',deliveryStage:row.delivery_stage,updatedAt:row.updated_at,...overrides};}
function batch(statuses=[],overrides={}){return receiver.syncBatch.parse({protocol:2,id:randomUUID(),clientId,revision:'1',catalog:[],statuses,...overrides});}
const reason='Seçilən məhsul hazırda anbarda yoxdur.';
for(const invalidReason of [undefined,null,'','test','sadasd','aaaaaa','<script>ləğv</script>','12345','\u200bMəhsul yoxdur']){
 const rejected=order(),other=order({status:'pending',delivery_stage:'received'}),{sql,state}=fixture([rejected,other]);
 const result=await receiver.applyDesktopBatch(sql,batch([status(rejected,{cancellationReason:invalidReason}),status(other,{status:'pending',deliveryStage:'preparing'})],{catalog:[publicProduct]}),actor);
 assert.equal(result.stale,false);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].id,rejected.id);assert.match(result.conflicts[0].reason,/Ləğv səbəbini/);
 assert.equal(state.orders.get(rejected.id).status,'ready','Invalid/missing historical reason does not silently cancel an order');
 assert.equal(state.orders.get(other.id).delivery_stage,'preparing','A legacy reason conflict cannot reject an unrelated valid status');
 assert.equal(result.published,1,'A per-order reason conflict cannot block the public catalogue batch');assert.equal(state.writes.length,1);
}
{
 const row=order(),{sql,state}=fixture([row]);const result=await receiver.applyDesktopBatch(sql,batch([status(row,{cancellationReason:'  Seçilən məhsul\n hazırda anbarda yoxdur.  '})]),actor);
 assert.equal(result.conflicts.length,0);assert.equal(state.orders.get(row.id).status,'cancelled');assert.equal(state.orders.get(row.id).cancellation_reason,reason);
 assert.ok(state.orders.get(row.id).cancelled_at);assert.equal(state.audits.length,1);assert.equal(state.audits[0].after.cancellationReason,reason);assert.equal(state.commits,1);
 assert.equal(smtpCalls,0,'No SMTP module/send is needed for an order with account_id=null');
 assert.ok(state.queries.every(query=>!query.includes('customer_accounts')),'No customer email/account access is performed for account_id=null');
 const before=structuredClone({writes:state.writes,audits:state.audits,order:state.orders.get(row.id)});
 const replay=await receiver.applyDesktopBatch(sql,batch([status(row,{cancellationReason:reason})]),actor);
 assert.equal(replay.stale,true);assert.deepEqual({writes:state.writes,audits:state.audits,order:state.orders.get(row.id)},before,'An acknowledged revision never repeats cancellation/audit writes');
 const current=state.orders.get(row.id),same=await receiver.applyDesktopBatch(sql,batch([status(current,{cancellationReason:reason})],{revision:'2'}),actor);
 assert.equal(same.conflicts.length,0);assert.equal(state.writes.length,1,'Identical terminal cancellation is idempotent even with a new batch revision');
}
{
 const row=order(),{sql,state}=fixture([row]);state.paid.add(row.id);
 const result=await receiver.applyDesktopBatch(sql,batch([status(row,{cancellationReason:reason})]),actor);
 assert.equal(result.conflicts.length,1);assert.match(result.conflicts[0].reason,/ödənilib/);assert.equal(state.writes.length,0);assert.equal(state.orders.get(row.id).status,'ready');
}
for(const [label,row,change]of [
 ['cancelled cannot reopen',order({status:'cancelled',cancellation_reason:reason}),{status:'ready'}],
 ['completed cannot become pending',order({status:'completed'}),{status:'pending'}],
 ['changed timestamp is stale',order(),{updatedAt:'2026-11-15 10:00:00.123455+00',cancellationReason:reason}],
 ['delivery stage cannot regress',order({delivery_stage:'dispatched'}),{status:'ready',deliveryStage:'ready'}],
 ['pickup cannot dispatch',order({fulfillment:'pickup'}),{status:'ready',deliveryStage:'dispatched'}],
 ['terminal reason cannot change',order({status:'cancelled',cancellation_reason:reason}),{cancellationReason:'Müştəri fərqli məhsul sifariş edib.'}],
 ]){
 const {sql,state}=fixture([row]);const result=await receiver.applyDesktopBatch(sql,batch([status(row,change)]),actor);
 assert.equal(result.conflicts.length,1,label);assert.equal(state.writes.length,0,label);assert.deepEqual(state.orders.get(row.id),row,label);
}
{
 const {sql,state}=fixture();const result=await receiver.applyDesktopBatch(sql,batch([{id:randomUUID(),status:'ready',deliveryStage:'ready',updatedAt:time}]),actor);
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].status,'missing');assert.equal(state.writes.length,0);
}
{
 const row=order(),{sql,state}=fixture([row]);state.settings.set('desktop_catalog_device',randomUUID());
 await assert.rejects(receiver.applyDesktopBatch(sql,batch([status(row,{cancellationReason:reason})]),actor),/başqa kompüter/);assert.equal(state.writes.length,0);
}
const statusFields={id:randomUUID(),status:'cancelled',deliveryStage:'ready',updatedAt:time,cancellationReason:reason};
for(const [location,field]of [['top','stock'],['top','warehouses'],['top','DATABASE_URL'],['top','smtpSecret'],['status','account_id'],['status','password_hash'],['status','cost_price'],['status','quantity'],['status','email']]){
 const raw={protocol:2,id:randomUUID(),clientId,revision:'1',catalog:[],statuses:[{...statusFields}]};
 if(location==='top')raw[field]='private';else raw.statuses[0][field]='private';
 assert.equal(receiver.syncBatch.safeParse(raw).success,false,'Strict wire schema rejects private field '+location+'.'+field);
}
assert.equal(receiver.syncBatch.safeParse({protocol:2,id:randomUUID(),clientId,revision:'1',catalog:[],statuses:[{...statusFields,cancellationReason:'x'.repeat(501)}]}).success,false,'Bounded transport rejects oversized reason strings before applying any batch');
assert.ok(catalogCalls>0);assert.equal(smtpCalls,0);
console.log('PASS: real status receiver/cancellation validator, per-order legacy missing/invalid reason conflicts, independent catalogue/status application, normalized reason+audit after commit, paid/terminal/stale/stage guards, stale-revision and identical-cancellation replay, account-null SMTP isolation and strict private-field exclusion. Mock SQL only; no DB/network/profile.');
