import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {NextRequest} from 'next/server.js';
import ts from 'typescript';

// Exercise the real proxy, not a duplicate permission implementation. Only its
// database/NextResponse boundary is mocked; this script never opens a database.
const require=createRequire(import.meta.url),previous={local:process.env.BIRKASSA_LOCAL,url:process.env.DATABASE_URL};
const fixtureUrl='postgres://sales-period-proxy.invalid/never-connected',token='sales-period-proxy-fixture';
async function load(file,mocks={},source){
 const compiled=ts.transpileModule(source??await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
class MockNextResponse extends Response{
 static next(options){const response=new MockNextResponse(null,{status:200,headers:{'x-middleware-next':'1'}});response.forwardedHeaders=options?.request?.headers;return response;}
 static json(body,options){return new MockNextResponse(JSON.stringify(body),{...options,headers:{'content-type':'application/json',...options?.headers}});}
 static redirect(url,status=307){return new MockNextResponse(null,{status,headers:{location:String(url)}});}
}
process.env.DATABASE_URL=fixtureUrl;process.env.BIRKASSA_LOCAL='1';
try{
 const inventory=await load('lib/inventory-mode.ts'),security=await load('lib/admin-security.ts'),roles=await load('lib/staff-access.ts'),portal=await load('lib/staff-portal.ts');
 assert.equal(inventory.inventoryPathRequiresLocal('/api/sales-period'),true,'Reporting reset must remain desktop-only');
 let role='admin',valid=true,active=true,authenticationMethod='password',queries=0,closes=0;
 const sql={async unsafe(query,params){
  queries++;assert.match(query,/^select .*from auth_sessions s join users u /);assert.deepEqual(params,[createHash('sha256').update(token).digest('hex')]);
  assert.match(query,/expires_at>now\(\).*is_active=true.*password_hash is not null/);
  return valid?[{id:'actual-session-user',role,authentication_method:authenticationMethod,active}]:[];
 },async end(){closes++;}};
 const mocks={'next/server':{NextResponse:MockNextResponse},postgres:url=>{assert.equal(url,fixtureUrl);return sql;},'./lib/log-error':{logSystemError:async()=>assert.fail('Unexpected proxy database failure')},'./lib/admin-security':security,'./lib/staff-access':roles,'./lib/staff-portal':portal,'./lib/inventory-mode':inventory};
 const source=await readFile('proxy.ts','utf8');
 const real=await load('proxy.ts',mocks,source+'\nexport const __fixtureRules=rules;');
 const exact=real.__fixtureRules.filter(rule=>rule.prefix==='/api/sales-period');
 assert.deepEqual(exact,[{prefix:'/api/sales-period',read:['admin'],write:['admin']}],'The actual proxy must explicitly allow only admin for this new route');
 assert.ok(real.__fixtureRules.indexOf(exact[0])<real.__fixtureRules.findIndex(rule=>rule.prefix==='/api/sales'),'Place the dedicated rule before sales');
 const request=({path='/api/sales-period',method='GET',cookie=true,native=false,headers={}}={})=>new NextRequest('http://127.0.0.1:5760'+path,{method,headers:{host:'127.0.0.1:5760',origin:'http://127.0.0.1:5760',...(cookie?{cookie:'birkassa_session='+token}:{}),...(native?{authorization:'Bearer fixture-native-authority'}:{}),'x-birkassa-role':'admin','x-birkassa-user-id':'forged-user',...headers}});
 for(const method of ['GET','HEAD','POST']){
  const response=await real.proxy(request({method,native:method==='POST'}));assert.equal(response.status,200,method+' reaches its independently protected route');
  assert.equal(response.headers.get('x-middleware-next'),'1');assert.equal(response.forwardedHeaders.get('x-birkassa-user-id'),'actual-session-user');assert.equal(response.forwardedHeaders.get('x-birkassa-role'),'admin');assert.match(response.headers.get('cache-control'),/no-store/);
 }
 for(const value of [undefined,'0','true','yes']){
  if(value===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=value;
  for(const method of ['GET','POST']){const response=await real.proxy(request({method,native:true}));assert.equal(response.status,403,'A web admin cannot reset local sales');assert.equal((await response.json()).code,'INVENTORY_LOCAL_ONLY');assert.equal(response.forwardedHeaders,undefined);}
 }
 process.env.BIRKASSA_LOCAL='1';
 for(const nonAdmin of roles.staffRoles.filter(value=>value!=='admin')){
  role=nonAdmin;for(const method of ['GET','POST'])assert.equal((await real.proxy(request({method,native:true}))).status,403,nonAdmin+' remains denied despite forged admin headers/native bearer');
 }
 role='owner';assert.equal((await real.proxy(request())).status,401,'Unknown roles do not inherit admin');role='admin';
 for(const options of [{cookie:false},{cookie:false,native:true,method:'POST'}]){const before=queries;assert.equal((await real.proxy(request(options))).status,401,'Forged identity/native authorization cannot replace a staff session');assert.equal(queries,before);}
 valid=false;assert.equal((await real.proxy(request())).status,401);valid=true;
 active=false;assert.equal((await real.proxy(request())).status,401);active=true;
 authenticationMethod='pin';assert.equal((await real.proxy(request())).status,401);authenticationMethod='password';
 for(const headers of [{origin:'https://attacker.invalid'},{'sec-fetch-site':'cross-site'}]){const before=queries;assert.equal((await real.proxy(request({method:'POST',native:true,headers}))).status,403,'Cross-site native-looking reset is blocked before authentication SQL');assert.equal(queries,before);}
 for(const path of ['/api/sales-period-extra','/api/sales-periodicity','/api/sales-period_fake']){const before=queries;assert.equal((await real.proxy(request({path}))).status,403,'Rule prefixes require an exact path or slash boundary');assert.equal(queries,before,'Unknown route cannot borrow the sales-period authorization');}
 assert.equal(queries,closes,'Every auth connection is closed');
 // Mutation proof: the old build omitted this rule. Valid admin must fail here,
 // proving this test detects the packaged HTTP regression missed by handler tests.
 const removed=source.replace(/\s*\{prefix:\s*['"]\/api\/sales-period['"],\s*read:\s*\[\s*['"]admin['"]\s*\],\s*write:\s*\[\s*['"]admin['"]\s*\]\},?/,'');
 assert.notEqual(removed,source);const withoutRule=await load('proxy.ts',mocks,removed);assert.equal((await withoutRule.proxy(request())).status,403);
 console.log('PASS: actual sales-period Proxy rule, local admin forwarding/identity reconstruction, web local-only boundary, every non-admin denied, session/native/forged-header separation, cross-site protection, prefix boundaries and missing-rule mutation regression; no network or database.');
}finally{
 for(const [key,value]of Object.entries({BIRKASSA_LOCAL:previous.local,DATABASE_URL:previous.url}))if(value===undefined)delete process.env[key];else process.env[key]=value;
}
