import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const compiled=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}

const previousLocal=process.env.BIRKASSA_LOCAL;
try{
// Finance retains its full contract in the EXE only; the web boundary regression
// separately asserts this endpoint is denied before business SQL.
process.env.BIRKASSA_LOCAL='1';
const policy=await load('lib/staff-access.ts'),security=await load('lib/admin-security.ts'),inventory=await load('lib/inventory-mode.ts');
const fixtureId='00000000-0000-4000-8000-000000000001';
const rows=[
 [{revenue:'130.00',cogs:'46.00',receipts:'2'}],
 [{expenses:'310.00',other_income:'7.00',payroll:'300.00'}],
 [{id:'sale-fixture',receipt_no:'QA-001',created_at:'2026-11-07T08:00:00Z',total:'65.00',cost:'23.00',cashier:'Fixture cashier',branch:'Fixture store',warehouse:'Fixture warehouse',items:[{name:'Historical product name',option:'40 sm · Qara',quantity:'1',salePrice:'65.00',costPrice:'23.00'}]}],
 [{id:'expense-fixture',type:'expense',category:'Kommunal',description:'Fixture electricity payment',account:'bank',amount:'10.00',occurred_at:'2026-11-07T08:00:00Z',payee:'Fixture payee',note:'Fixture note',wage_period:null,branch:'Fixture store',employee:null}],
 [{category:'Kommunal',amount:'10.00'}],
 [{id:fixtureId,name:'Fixture store'}],
 [{id:fixtureId,full_name:'Fixture cashier',salary:null,branch_id:fixtureId,branch:'Fixture store'}],
 [{id:fixtureId,name:'Fixture supplier',debt:'27.50'}],
];
let role='admin',queryIndex=0,failingQuery=-1,queries=[],closes=0;
const db={
 async unsafe(query,params=[]){
  assert.match(query,/^select\b/i,'Finance GET must not mutate data');
  if(query.includes('from auth_sessions'))return [{id:fixtureId,role}];
  const index=queryIndex++;queries.push({query,params});
  // Production PostgreSQL 13 rejects bare COST as a SELECT output alias. The
  // newer local fixture parser permits it, so keep this explicit compatibility
  // regression in addition to the server's actual read-only EXPLAIN proof.
  if(/coalesce\(costs\.amount,0\)\s+cost\s*,/i.test(query))throw Object.assign(Error('syntax error at or near "cost"'),{code:'42601'});
  if(/\)\s+names\s+from stock_movements/i.test(query))throw Object.assign(Error('syntax error at or near "names"'),{code:'42601'});
  if(index===failingQuery)throw Object.assign(Error('Fixture private database failure'),{code:'42703'});
  assert.ok(rows[index],'Unexpected extra finance query');
  return structuredClone(rows[index]);
 },
 async end(){closes++;},
};
const {withAdminSession}=await load('lib/require-admin.ts',{'@/lib/staff-access':policy,'@/lib/admin-security':security,'@/lib/store-db':{storeDb:()=>db},'@/lib/inventory-mode':inventory});
const finance=await load('app/api/finance/route.ts',{'@/lib/require-admin':{withAdminSession},'@/lib/store-db':{storeDb:()=>db}});
const request=(search='',authenticated=true)=>new Request('https://staff.example/api/finance'+search,{headers:{host:'staff.example',...(authenticated?{cookie:'birkassa_session=fixture'}:{}),'x-birkassa-role':'admin','x-birkassa-user-id':'forged'}});
const reset=()=>{queryIndex=0;queries=[];failingQuery=-1;closes=0;};
for(const allowed of ['admin','manager','accountant']){
 reset();role=allowed;
 const response=await finance.GET(request('?from=2026-11-01&to=2026-11-07&branch='+fixtureId));
 assert.equal(response.status,200,allowed+' finance remains available');
 assert.match(response.headers.get('cache-control'),/no-store/);
 const data=await response.json();
 assert.deepEqual(data.range,{from:'2026-11-01',to:'2026-11-07',branch:fixtureId});
 assert.deepEqual(data.metrics,{revenue:130,costOfGoods:46,grossProfit:84,expenses:310,otherIncome:7,payroll:300,netProfit:-219,receipts:2});
 assert.equal(data.sales[0].cost,23);assert.equal(data.sales[0].profit,42);
 assert.equal(data.sales[0].items[0].name,'Historical product name');
 assert.equal(data.sales[0].items[0].costPrice,'23.00','Historical cost snapshot is not replaced with current purchase price');
 assert.equal(data.recent[0].amount,10);assert.equal(data.employees[0].salary,0);assert.equal(data.debts[0].debt,27.5);
 assert.equal(queries.length,8);assert.equal(closes,2,'Guard and finance connections are closed');
 assert.match(queries[2].query,/coalesce\(costs\.amount,0\)\s+as\s+"cost"\s*,/i,'Quote the PostgreSQL-13 keyword while preserving the cost DTO key');
 assert.match(queries[2].query,/\)\s+as\s+"names"\s+from stock_movements/i,'The nested warehouse aggregate must also work on PostgreSQL13');
 for(const {params}of queries.slice(0,5))assert.deepEqual(params,['2026-11-01','2026-11-07',fixtureId]);
}
for(const denied of ['cashier','warehouse','online_manager','online_assistant']){
 reset();role=denied;assert.equal((await finance.GET(request())).status,403);assert.equal(queries.length,0,'No finance query for '+denied);
}
reset();role='owner';assert.equal((await finance.GET(request())).status,401);assert.equal(queries.length,0);
reset();role='admin';assert.equal((await finance.GET(request('',false))).status,401);assert.equal(queries.length,0);
for(const search of ['?from=2026-02-30','?from=2026-11-08&to=2026-11-07','?from=2020-01-01&to=2026-11-07','?branch=not-a-uuid']){
 reset();assert.equal((await finance.GET(request(search))).status,400);assert.equal(queries.length,0);
}
reset();const defaults=await finance.GET(request());assert.equal(defaults.status,200);const range=(await defaults.json()).range;assert.match(range.to,/^\d{4}-\d{2}-\d{2}$/);assert.equal(range.from,range.to.slice(0,7)+'-01');
const originalError=console.error;
try{
 const logged=[];console.error=(...args)=>logged.push(args);
 for(let index=0;index<8;index++){
  reset();failingQuery=index;
  const response=await finance.GET(request('?from=2026-11-01&to=2026-11-07'));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Maliyyə məlumatları yüklənmədi.'},'Never conceal a failed financial query with fabricated zero totals or private diagnostics');
  assert.equal(closes,2);
 }
 assert.equal(logged.length,8,'Database errors remain diagnosable in private server logs');
}finally{console.error=originalError;}

// Exercise the real finance component's effects and retry callback with a small
// deterministic hook harness, without starting a browser/server or submitting a
// financial write. Its markup must leave the loading state after failed reads.
let hooks=[],cursor=0,effects=[],reply,requests=[];
const react={
 useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
 useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},
 useEffect(callback){const index=cursor++;if(!(index in hooks)){hooks[index]=true;effects.push(callback);}},
};
const {default:FinanceOverview}=await load('app/admin/finance-overview.tsx',{'react':react,'@/lib/language':{languageAmount:value=>Number(value).toFixed(2),useTranslations:()=>({t:value=>value})},'./operations.css':{}});
const render=()=>{cursor=0;return renderToStaticMarkup(createElement(FinanceOverview,{canEditSalary:false}));};
const flush=async()=>{for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));};
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return reply();};
 hooks=[];cursor=0;effects=[];requests=[];
 reply=()=>Response.json({error:'Maliyyə məlumatları yüklənmədi.'},{status:503});
 assert.match(render(),/role="status"[^>]*>Yüklənir…/);
 effects[0]();await flush();
 const failedHtml=render();assert.match(failedHtml,/role="alert"/);assert.ok(failedHtml.includes('Yenidən cəhd et'));assert.ok(!failedHtml.includes('Yüklənir…'),'Failure cannot leave a perpetual loading placeholder');
 cursor=0;const tree=FinanceOverview({canEditSalary:false});
 function buttons(node){if(!node||typeof node!=='object')return [];const children=node.props?.children;return [...(node.type==='button'?[node]:[]),...(Array.isArray(children)?children.flat(Infinity):[children]).flatMap(buttons)];}
 const retry=buttons(tree).find(node=>node.props.children==='Yenidən cəhd et');assert.ok(retry);
 reply=()=>Response.json({range:{from:'2026-11-01',to:'2026-11-07'},metrics:{revenue:130,costOfGoods:46,grossProfit:84,expenses:310,otherIncome:7,payroll:300,netProfit:-219},sales:[],recent:[],categories:[],branches:[],employees:[],debts:[]});
 retry.props.onClick();await flush();const recoveredHtml=render();assert.ok(recoveredHtml.includes('130.00'));assert.ok(!recoveredHtml.includes('role="alert"'));assert.ok(!recoveredHtml.includes('Yenidən cəhd et'));
 assert.equal(requests.length,2);for(const {options}of requests)assert.ok(!options.method||options.method==='GET','Retry is a read, never a duplicate expense/payment');
 hooks=[];cursor=0;effects=[];reply=()=>new Response('<html>upstream unavailable</html>',{status:502});render();effects[0]();await flush();
 const invalidHtml=render();assert.ok(invalidHtml.includes('Maliyyə məlumatları yüklənmədi.'));assert.ok(invalidHtml.includes('Yenidən cəhd et'));assert.ok(!invalidHtml.includes('Unexpected token'));assert.ok(!invalidHtml.includes('Yüklənir…'));
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: PostgreSQL13-compatible quoted cost alias, historical financial DTO/metrics, date/branch validation, role privacy and honest database errors; actual finance UI exits failed loading and retries reads without repeating payments. No server or database used.');
}finally{if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;}
