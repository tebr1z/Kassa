import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Pure policy fixtures only: no database, outbox, network or desktop profile.
const source=await readFile('lib/desktop-outbound-conflicts.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[]);
assert.doesNotMatch(compiled.outputText,/\bimport\s/,'The helper has no runtime dependencies');
const {filterDesktopOutboundChanges:filter}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));
const deltaSource=await readFile('lib/desktop-catalog-delta.ts','utf8');
const fieldList=/export const publicProductFields=\[([\s\S]*?)\] as const/.exec(deltaSource)?.[1];assert.ok(fieldList);
const fields=[...fieldList.matchAll(/'([^']+)'/g)].map(match=>match[1]);
const product={id:'local-a',sku:'NEW-SKU',name:'Local name',code:'123456',category:'Fixtures',unit:'ədəd',price:20,discountPrice:15,image:'/api/desktop-media/'+'a'.repeat(64),images:['/api/desktop-media/'+'b'.repeat(64)],options:[{label:'40 · Red',size:'40',color:'Red',kind:'',image:'',price:20,position:0,isActive:true,attributes:{thickness:'2 mm'}}],isActive:true,description:'Local description',specifications:'Local specifications'};
const previous={...structuredClone(product),sku:'OLD-SKU',name:'Previous name',price:10};
const change={...product,changedFields:[...fields],previous};
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
freeze(change);
const input=freeze([change]),before=JSON.stringify(input);
function mapping(conflicts,id='local-a'){return {local_product_id:id,conflicts};}
function assertValuesUnchanged(row){
 assert.notStrictEqual(row,change);assert.notStrictEqual(row.changedFields,change.changedFields);
 assert.strictEqual(row.previous,previous,'Never rewrite the baseline snapshot');
 for(const field of ['id',...fields])assert.strictEqual(row[field],change[field],field+' keeps its exact original value/reference');
 for(const privateField of ['stock','cost_price','costPrice','barcode','salary','finance','reason','conflicts','local_product_id'])assert.equal(Object.hasOwn(row,privateField),false,'Conflict metadata cannot leak '+privateField);
}
const unchanged=filter(input,[],[]);assert.notStrictEqual(unchanged,input);assert.deepEqual(unchanged,input);assertValuesUnchanged(unchanged[0]);
const noFlags=filter(input,[mapping([])],[]);assert.deepEqual(noFlags,input);assertValuesUnchanged(noFlags[0]);
const partial=filter(input,[mapping(['price','name']),mapping(['images'])]);
assert.deepEqual(partial[0].changedFields,fields.filter(field=>!['price','name','images'].includes(field)));assertValuesUnchanged(partial[0]);
assert.equal(partial[0].price,20,'Only changedFields is filtered; the value is not replaced by old web data');
assert.equal(partial[0].previous.price,10);
for(const token of ['review','identity','photo','error','unknown','stock','cost_price','__proto__','constructor','',null,17,{}]){
 assert.deepEqual(filter(input,[mapping([token])]),[],String(token)+' is fail-closed, including a pending isActive deletion');
 assert.deepEqual(filter(input,[mapping(['price',token])]),[],String(token)+' cannot be hidden behind valid fields');
 assert.deepEqual(filter(input,[],[{id:'local-a',fields:[token]}]),[],String(token)+' error metadata is fail-closed');
}
for(const malformed of [null,undefined,'["price"]','price',false,0,{},new Set(['price'])])assert.deepEqual(filter(input,[mapping(malformed)]),[],'Malformed matching mappings never clear a hold');
assert.deepEqual(filter(input,[mapping(null),mapping([])]),[],'A later empty mapping cannot clear an earlier unknown hold');
assert.deepEqual(filter(input,[mapping([]),mapping(null)]),[]);
assert.deepEqual(filter(input,[mapping(fields)]),[],'Entries with no safe changed fields are removed entirely');
assert.deepEqual(filter([{...change,isActive:false,changedFields:['isActive']}],[mapping(['identity'])]),[],'Identity conflicts also block outbound archives');

for(const match of [{id:'local-a'},{sku:'NEW-SKU'},{sku:'OLD-SKU'},{id:'remote-remapped-id',sku:'NEW-SKU'},{id:'local-a',sku:'unrelated'}]){
 const result=filter(input,[],[{...match,fields:['price','discountPrice']}]);
 assert.deepEqual(result[0].changedFields,fields.filter(field=>!['price','discountPrice'].includes(field)),JSON.stringify(match)+' matches local identity or current/prior shared SKU');
 assertValuesUnchanged(result[0]);
}
const union=filter(input,[mapping(['name'])],[{id:'local-a',fields:['price']},{sku:'NEW-SKU',fields:['images']},{sku:'OLD-SKU',fields:['options']}]);
assert.deepEqual(union[0].changedFields,fields.filter(field=>!['name','price','images','options'].includes(field)));
for(const malformed of [undefined,null,[],{},['identity'],['price','not-public']])assert.deepEqual(filter(input,[],[{sku:'NEW-SKU',fields:malformed}]),[],'Matching errors with missing/empty/unknown fields block everything');
assert.deepEqual(filter(input,[mapping(['review'],'unrelated')],[{id:'remote-remapped-id',sku:'unrelated',fields:['identity']},{fields:['identity']}]),input,'Unmatched rows and unscoped errors cannot block unrelated products');

const second={...structuredClone(change),id:'local-b',sku:'OTHER-SKU',previous:null};
const isolated=filter([change,second],[mapping(['review'])],[{id:'local-b',fields:['price']}]);
assert.equal(isolated.length,1);assert.equal(isolated[0].id,'local-b');assert.equal(isolated[0].changedFields.includes('price'),false);assert.equal(isolated[0].changedFields.includes('isActive'),true,'A conflict on one local mapping never becomes a global hold');
const metadata=freeze([{...mapping(['name']),stock:999999,cost_price:654321,finance:{salary:999}}]);
const privateErrors=freeze([{id:'local-a',fields:['price'],stock:999999,reason:'PRIVATE-NOT-OUTPUT'}]);
const safe=filter(input,metadata,privateErrors);assertValuesUnchanged(safe[0]);assert.doesNotMatch(JSON.stringify(safe),/999999|654321|PRIVATE-NOT-OUTPUT/);
assert.equal(JSON.stringify(input),before,'All frozen source data remains unchanged');
console.log('Desktop outbound conflict holds: field-level unions, fail-closed markers/malformed metadata, SKU remapping, archive protection, public-only metadata and immutable snapshots PASS');
