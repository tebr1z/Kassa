import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const policyUrl=moduleUrl(ts.transpile(await readFile('lib/admin-security.ts','utf8'),{module:ts.ModuleKind.ESNext}));
const rolesUrl=moduleUrl(ts.transpile(await readFile('lib/staff-access.ts','utf8'),{module:ts.ModuleKind.ESNext}));
const inventoryUrl=moduleUrl(ts.transpile((await readFile('lib/inventory-mode.ts','utf8')).replace("import 'server-only';",''),{module:ts.ModuleKind.ESNext}));
const dbUrl=moduleUrl(`export let valid=false,failing=false;export function configure(ok,error=false){valid=ok;failing=error;}export function storeDb(){return {unsafe:async()=>{if(failing)throw Error('unavailable');return valid?[{id:'actual-admin',role:'admin'}]:[];},end:async()=>{}};}`);
let source=await readFile('lib/require-admin.ts','utf8');
source=source.replace("import 'server-only';",'').replace("@/lib/store-db",dbUrl).replace("@/lib/admin-security",policyUrl).replace('@/lib/staff-access',rolesUrl).replace('@/lib/inventory-mode',inventoryUrl);
const {withAdminSession}=await import(moduleUrl(ts.transpile(source,{module:ts.ModuleKind.ESNext})));
const db=await import(dbUrl);
const previousLocal=process.env.BIRKASSA_LOCAL;
try{
process.env.BIRKASSA_LOCAL='1';
let calls=0;
const guarded=withAdminSession(request=>{calls++;return Response.json({id:request.headers.get('x-birkassa-user-id'),role:request.headers.get('x-birkassa-role')});});
const request=(options={})=>new Request('http://127.0.0.1/api/products',options);
assert.equal((await guarded(request({headers:{'x-birkassa-user-id':'forged','x-birkassa-role':'admin'}}))).status,401);
const headers={Cookie:'birkassa_session=fixture','x-birkassa-user-id':'forged','x-birkassa-role':'cashier'};
assert.equal((await guarded(request({headers}))).status,401);assert.equal(calls,0);
db.configure(true);const allowed=await guarded(request({headers}));assert.deepEqual(await allowed.json(),{id:'actual-admin',role:'admin'});assert.match(allowed.headers.get('cache-control'),/no-store/);
process.env.BIRKASSA_LOCAL='0';const web=await guarded(request({headers}));assert.equal(web.status,403);assert.equal((await web.json()).code,'INVENTORY_LOCAL_ONLY');assert.equal(calls,1);process.env.BIRKASSA_LOCAL='1';
assert.equal((await guarded(request({method:'POST',headers:{...headers,Origin:'https://attacker.example'}}))).status,403);
assert.equal((await guarded(new Request('http://shop.example/api/products',{headers}))).status,426);
db.configure(false,true);assert.equal((await guarded(request({headers}))).status,503);assert.equal(calls,1);
console.log('PASS: direct route guard rejects unauthenticated/forged/cross-origin/HTTP/database-failure calls without Proxy and rebuilds identity from the database.');
}finally{if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;}
