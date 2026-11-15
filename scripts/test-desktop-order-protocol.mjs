import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Pure contract checks run in Linux CI as well as Windows. They execute the
// actual schema/cursor functions without opening a file profile, DB or socket.
const require=createRequire(import.meta.url),zodUrl=pathToFileURL(require.resolve('zod')).href;
const schemaSource=await readFile('lib/desktop-order-import.ts','utf8');
const syncSource=await readFile('lib/desktop-sync.ts','utf8');
async function evaluate(source){
 const compiled=ts.transpileModule('import {z} from '+JSON.stringify(zodUrl)+';\n'+source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
}
const schemaStart=schemaSource.indexOf('const money='),schemaEnd=schemaSource.indexOf('export type RemoteOrder');
assert.ok(schemaStart>=0&&schemaEnd>schemaStart,'The shared order schema must remain available to contract tests');
const {remoteOrderSchema}=await evaluate(schemaSource.slice(schemaStart,schemaEnd));
const base={id:'a5be99a9-7600-4878-a737-68fa30e07b74',order_no:'1501',status:'pending',fulfillment:'pickup',delivery_address:'',delivery_stage:'received',
 total:'12.00',coupon_discount:'0',note:null,full_name:'Tarixi müştəri',phone:null,created_at:'2026-11-15T10:00:00.000Z',updated_at:'2026-11-15 10:00:00.123456+00',
 items:[{sku:'QA-40',name:'Manqal',option_snapshot:'40 sm · Qırmızı · Qalınlıq: 2 mm',quantity:'1',unit_price:'12.00',line_total:'12.00'}]};
const parsed=remoteOrderSchema.parse(base);
assert.equal(parsed.total,12);assert.equal(parsed.items[0].quantity,1);assert.equal(parsed.delivery_fee,0);assert.equal(parsed.distance_meters,null);
assert.equal(parsed.cancellation_reason,null);assert.equal(parsed.cancelled_at,null);assert.equal(parsed.items[0].option_snapshot,base.items[0].option_snapshot);
for(const status of ['pending','ready','completed','cancelled'])assert.ok(remoteOrderSchema.safeParse({...base,status}).success,status+' is a supported historical order state');
for(const delivery_stage of ['received','preparing','ready','delivered'])assert.ok(remoteOrderSchema.safeParse({...base,delivery_stage}).success);
assert.ok(remoteOrderSchema.safeParse({...base,fulfillment:'delivery',delivery_stage:'dispatched',delivery_address:'Bakı, Nizami küçəsi 1',delivery_fee:3,total:15}).success);
const reason='Məhsul hazırda anbarda yoxdur.';
const cancelled=remoteOrderSchema.parse({...base,status:'cancelled',cancellation_reason:reason,cancelled_at:'2026-11-15T14:30:00+04:00'});
assert.equal(cancelled.cancellation_reason,reason);assert.equal(cancelled.cancelled_at,'2026-11-15T14:30:00+04:00');
assert.ok(remoteOrderSchema.safeParse({...base,status:'cancelled',cancellation_reason:null,cancelled_at:null}).success,'Missing historical cancellation reasons are not fabricated');
const decimals={...base,total:0.87,items:[{...base.items[0],quantity:3,unit_price:0.29,line_total:0.87}]};
assert.ok(remoteOrderSchema.safeParse(decimals).success,'Currency line rounding is accepted');
const second={...base.items[0],option_snapshot:'50 sm · Yaşıl',unit_price:15,line_total:15};
assert.ok(remoteOrderSchema.safeParse({...base,total:25,coupon_discount:2,items:[base.items[0],second]}).success,'Distinct choices of one product remain independent lines');
for(const [name,patch]of Object.entries({
 malformedId:{id:'not-an-id'},emptyNumber:{order_no:''},unknownStatus:{status:'paid'},unknownStage:{delivery_stage:'unknown'},
 pickupDispatched:{delivery_stage:'dispatched'},pickupFee:{delivery_fee:3,total:15},wrongTotal:{total:13},negativeDiscount:{coupon_discount:-1},excessDiscount:{coupon_discount:13},
 shortReason:{cancellation_reason:'x'},oversizedReason:{cancellation_reason:'x'.repeat(501)},badCancelTime:{cancelled_at:'yesterday'},badUpdatedTime:{updated_at:'11'},
 oversizedName:{full_name:'x'.repeat(201)},oversizedNote:{note:'x'.repeat(5001)},emptyItems:{items:[]},tooManyItems:{items:Array.from({length:501},()=>base.items[0])},
 duplicatedChoice:{total:24,items:[base.items[0],{...base.items[0]}]},
 wrongLineArithmetic:{items:[{...base.items[0],line_total:11}],total:11},fractionalQuantity:{items:[{...base.items[0],quantity:0.5,line_total:6}],total:6},
 infiniteQuantity:{items:[{...base.items[0],quantity:Infinity}]},negativePrice:{items:[{...base.items[0],unit_price:-1}]},
 nanTotal:{total:'NaN'},oversizedTotal:{total:1000000000000},badProductId:{items:[{...base.items[0],product_id:'private'}]},
 oversizedChoice:{items:[{...base.items[0],option_snapshot:'x'.repeat(3001)}]},
 }))assert.equal(remoteOrderSchema.safeParse({...base,...patch}).success,false,name);
assert.equal(remoteOrderSchema.safeParse({...decimals,total:0.88,items:[{...decimals.items[0],line_total:0.88}]}).success,false,'A one-cent incorrect line is rejected even when the order total repeats it');
const publicProjection=remoteOrderSchema.parse({...base,stock:[1],warehouses:[1],password_hash:'not-real',created_by:'untrusted-actor',
 items:[{...base.items[0],cost_price:7,barcode:'private',stock:100}]});
for(const field of ['stock','warehouses','password_hash','created_by'])assert.ok(!(field in publicProjection),'Parsed public order excludes '+field);
for(const field of ['cost_price','barcode','stock'])assert.ok(!(field in publicProjection.items[0]),'Parsed order line excludes '+field);

const cursorStart=syncSource.indexOf('const cursorSchema='),cursorEnd=syncSource.indexOf('export async function fetchOrderPage');
assert.ok(cursorStart>=0&&cursorEnd>cursorStart,'Execute actual private cursor helpers without exporting them to the application API');
const {cursorParts,micros,compareCursor,rewindCursor}=await evaluate(syncSource.slice(cursorStart,cursorEnd)+'\nexport {cursorParts,micros,compareCursor,rewindCursor};');
const id='00000000-0000-4000-8000-000000000001',nextId='00000000-0000-4000-8000-000000000002';
const cursor=(time,uuid=id)=>Buffer.from(JSON.stringify({time,id:uuid})).toString('base64url');
assert.equal(micros('2026-11-15 10:00:00.123456+00')-micros('2026-11-15T10:00:00.123455Z'),1n,'PostgreSQL microseconds are never rounded to a JavaScript millisecond cursor');
assert.equal(micros('2026-11-15T14:00:00.123456+04:00'),micros('2026-11-15 10:00:00.123456+00'),'Time-zone offsets do not reorder the same instant');
assert.equal(compareCursor(cursor('2026-11-15T10:00:00.123456Z'),cursor('2026-11-15T10:00:00.123455Z')),1);
assert.equal(compareCursor(cursor('2026-11-15T10:00:00.123455Z'),cursor('2026-11-15T10:00:00.123456Z')),-1);
assert.equal(compareCursor(cursor('2026-11-15T10:00:00.123456Z',nextId),cursor('2026-11-15T10:00:00.123456Z',id)),1,'UUID tie-breaker preserves deterministic same-microsecond pagination');
assert.equal(compareCursor(cursor('2026-11-15T10:00:00.123456Z'),''),1);
assert.equal(compareCursor(cursor('2026-11-15T10:00:00.123456Z'),cursor('2026-11-15T10:00:00.123456Z')),0);
const rewind=cursorParts(rewindCursor(cursor('2026-11-15T10:00:00.123456Z')));
assert.equal(rewind.time,'2026-11-15T09:55:00.123Z');assert.equal(rewind.id,'00000000-0000-0000-0000-000000000000');assert.equal(rewindCursor(''),'');
for(const bad of ['not-json',Buffer.from('{}').toString('base64url'),cursor('yesterday'),cursor('2026-11-15T10:00:00Z','not-a-uuid'),Buffer.from(JSON.stringify({time:'2026-11-15T10:00:00Z',id,stock:1})).toString('base64url')])assert.throws(()=>cursorParts(bad));
assert.match(syncSource,/compareCursor\(data\.next,highwater\)>0/,'Durable high-water cursor cannot regress during a replay');
assert.ok(syncSource.includes('desktop_order_scan:'),'Large replays retain a continuation instead of starving later pages');
assert.ok(syncSource.includes('Date.now()-lastRescan>=3600000'),'A bounded hourly full replay catches older delayed commits');
assert.match(syncSource,/payload is distinct from/,'Unchanged replayed rows do not create new update notifications');
const feed=await readFile('app/api/desktop-feed/route.ts','utf8');
assert.ok(feed.includes('o.updated_at::text updated_at'));assert.ok(feed.includes('order by o.updated_at,o.id limit 100'));
assert.ok(feed.includes('o.cancellation_reason,o.cancelled_at'));assert.ok(feed.includes("'product_id',p.id"));
console.log('PASS: pure desktop order protocol schema, historical delivery/cancellation defaults, exact custom-choice snapshots, order/line arithmetic, duplicate and malformed isolation, public projection, PostgreSQL microsecond cursor/tie ordering, rewind and full-replay/nonregression source contracts. No network, DB or user-profile access.');
