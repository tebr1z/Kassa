import assert from 'node:assert/strict';
import {createHash,scryptSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Execute the actual policy, login and data-boundary guard without a server or
// database. All users, passwords and sessions below are disposable fixtures.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const source=await readFile(path,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}
const policy=await load('lib/staff-access.ts');
const roles=['admin','manager','cashier','warehouse','accountant','online_manager','online_assistant'];
assert.deepEqual([...policy.staffRoles],roles);
assert.equal(new Set(policy.staffRoles).size,roles.length);
assert.equal(Object.isFrozen(policy.staffRoles),true);
for(const role of roles)assert.equal(policy.isStaffRole(role),true);
for(const role of ['','owner','ADMIN','__proto__','constructor']){
 assert.equal(policy.isStaffRole(role),false);
 assert.deepEqual(policy.staffPermissions(role),[]);
}
assert.deepEqual(policy.staffPermissions('admin'),['*']);
assert.deepEqual(policy.staffPermissions('cashier'),['Satış / POS']);
assert.deepEqual(policy.staffPermissions('warehouse'),['Məhsullar','Anbar','Satınalma']);
assert.deepEqual(policy.staffPermissions('accountant'),['Maliyyə','Hesabatlar']);
assert.deepEqual(policy.staffPermissions('online_manager'),[]);
assert.deepEqual(policy.staffPermissions('online_assistant'),[]);
assert.equal(policy.staffPermissions('manager').includes('İnsan resursları'),false);
assert.equal(policy.staffPermissions('manager').includes('Tənzimləmələr'),false);
assert.equal(policy.staffPermissions('manager').includes('Veb sifarişləri'),false);
const changed=policy.staffPermissions('cashier');changed.push('*');
assert.deepEqual(policy.staffPermissions('cashier'),['Satış / POS']);

const read=['GET','HEAD'];
const expected={
 cashier:{'/api/products':read,'/api/dashboard':read,'/api/sales':['POST'],'/api/shifts':['POST'],'/api/pos-options':['GET','HEAD','POST','DELETE'],'/api/client-errors':['POST']},
 warehouse:{'/api/products':['GET','HEAD','POST','PATCH'],'/api/categories':['GET','HEAD','POST'],'/api/warehouses':read,'/api/stock/receipts':['POST'],'/api/stock/adjustments':['POST'],'/api/stock/transfers':['POST'],'/api/inventory-counts':['GET','HEAD','POST'],'/api/purchase-orders':['GET','HEAD','POST'],'/api/suppliers':['GET','HEAD','POST'],'/api/client-errors':['POST']},
 accountant:{'/api/finance':['GET','HEAD','POST'],'/api/reports':read,'/api/suppliers':read,'/api/client-errors':['POST']},
 manager:{'/api/dashboard':read,'/api/products':['GET','HEAD','POST','PATCH'],'/api/categories':['GET','HEAD','POST'],'/api/warehouses':read,'/api/stock/receipts':['POST'],'/api/stock/adjustments':['POST'],'/api/stock/transfers':['POST'],'/api/inventory-counts':['GET','HEAD','POST'],'/api/purchase-orders':['GET','HEAD','POST'],'/api/suppliers':['GET','HEAD','POST'],'/api/client-errors':['POST'],'/api/finance':['GET','HEAD','POST'],'/api/reports':read,'/api/sales':['POST'],'/api/shifts':['POST'],'/api/pos-options':['GET','HEAD','POST','DELETE'],'/api/orders':['GET','HEAD','POST'],'/api/returns':['POST'],'/api/audit':read,'/api/online-orders':['GET','HEAD','PATCH']},
 online_manager:{'/api/online-orders':['GET','HEAD','PATCH']},
 online_assistant:{'/api/online-orders':['GET','HEAD','PATCH']},
};
const paths=[...new Set(Object.values(expected).flatMap(map=>Object.keys(map))),'/api/employees','/api/settings','/api/locations','/api/system','/api/system/dump','/api/admin/delivery','/api/store-admin','/api/store-admin/commerce','/api/desktop-link','/api/desktop-inbox','/api/products/private','/api/stock','/api/stock/receipts/unapproved','/api/products/','/api/not-approved'];
const methods=['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS','TRACE','get','UNKNOWN'];
for(const role of [...roles,'owner','__proto__'])for(const path of paths)for(const method of methods){
 const allowed=role==='admin'||Boolean(expected[role]?.[path]?.includes(method));
 assert.equal(policy.canUseStaffApi(role,path,method),allowed,`${role} ${method} ${path}`);
}

const security=await load('lib/admin-security.ts');
const authCookie=await load('lib/auth-cookie.ts');
const fixturePassword='Fixture strong password 2026';
const fixturePin='246802';
const hash=value=>'fixture-salt:'+scryptSync(value,'fixture-salt',64).toString('hex');
const passwordHash=hash(fixturePassword),pinHash=hash(fixturePin);
const fixtureId='00000000-0000-4000-8000-000000000001';
const sha=value=>createHash('sha256').update(value).digest('hex');
let state;
function reset(role='admin',overrides={}){
 state={user:{id:fixtureId,full_name:'Fixture user',role,is_active:true,password_hash:passwordHash,pin_hash:null,...overrides},cookie:undefined,tokenHash:sha('fixture-token'),session:false,method:'password',idleMinutes:0,expired:false,attempts:0,sessionsCreated:0,passwordWrites:0,activityWrites:0,queries:[],failing:false};
}
function assertRolesQuery(query){
 const list=query.match(/(?:u\.)?role in \(([^)]+)\)/)?.[1];
 assert.ok(list,'every staff SQL query has an explicit role whitelist');
 assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map(match=>match[1]),roles);
}
function approvedUser(query){
 assertRolesQuery(query);
 assert.match(query,/(?:u\.)?is_active=true/);
 return state.user.is_active&&roles.includes(state.user.role);
}
function validSession(query,params){
 assert.match(query,/s\.expires_at>now\(\)/);
 assert.match(query,/s\.last_seen_at>now\(\)-interval '10 minutes'/);
 assert.match(query,/s\.authentication_method='password'/);
 assert.match(query,/u\.password_hash is not null/);
 return approvedUser(query)&&state.user.password_hash&&state.session&&params[0]===state.tokenHash&&state.method==='password'&&!state.expired&&state.idleMinutes<10;
}
const db={
 async unsafe(query,params=[]){
  state.queries.push({query,params});
  if(state.failing)throw Error('fixture database unavailable');
  if(query.startsWith('select u.id')&&query.includes('from auth_sessions'))return validSession(query,params)?[state.user]:[];
  if(query.startsWith('select id,full_name,role,pin_hash is not null')){
   assert.match(query,/role='admin' or password_hash is not null/);
   return approvedUser(query)&&(state.user.role==='admin'||state.user.password_hash)?[{...state.user,has_password:Boolean(state.user.password_hash),has_pin:Boolean(state.user.pin_hash)}]:[];
  }
  if(query.startsWith('insert into staff_auth_attempts'))return approvedUser(query)&&params[0]===state.user.id?[{attempts:++state.attempts}]:[];
  if(query.startsWith('select id,full_name,role,pin_hash,password_hash')){
   assert.match(query,/for update$/);
   return approvedUser(query)&&params[0]===state.user.id?[state.user]:[];
  }
  if(query.startsWith('update users set password_hash')){state.passwordWrites++;state.user.password_hash=params[0];return [];}
  if(query.startsWith('delete from auth_sessions')){state.session=false;return [];}
  if(query.startsWith('delete from staff_auth_attempts')){state.attempts=0;return [];}
  if(query.startsWith('insert into audit_logs'))return [];
  if(query.startsWith('insert into auth_sessions')){
   assert.match(query,/'password'\)/);
   assert.equal(params[0],state.user.id);
   assert.match(params[1],/^[0-9a-f]{64}$/);
   assert.ok(params[2] instanceof Date);
   state.sessionsCreated++;state.tokenHash=params[1];state.session=true;state.method='password';return [];
  }
  if(query.startsWith('update auth_sessions s set last_seen_at')){
   const valid=validSession(query,params);
   if(valid){state.activityWrites++;state.idleMinutes=0;}
   return valid?[{user_id:state.user.id}]:[];
  }
  throw Error('Unexpected fixture query: '+query);
 },
 async begin(callback){return callback(db);},
 async end(){},
};
const mocks={
 '@/lib/inventory-mode':await load('lib/inventory-mode.ts'),
 '@/lib/staff-access':policy,
 '@/lib/store-db':{storeDb:()=>db},
 '@/lib/admin-security':security,
 '@/lib/auth-cookie':authCookie,
 '@/lib/admin-setup':{adminSetupToken:async()=> 'fixture-setup-key-that-is-not-a-real-secret'},
 'next/headers':{cookies:async()=>({get:()=>state.cookie?{value:state.cookie}:undefined})},
};
const auth=await load('lib/desktop-auth.ts',mocks);
const {withAdminSession}=await load('lib/require-admin.ts',mocks);
const onlineOrders=await load('app/api/online-orders/route.ts',{'@/lib/require-admin':{withAdminSession},'@/lib/store-db':mocks['@/lib/store-db'],'@/lib/order-cancellation':await load('lib/order-cancellation.ts'),'@/lib/smtp-mail':{notifyCustomerEmail:async()=>{throw Error('A rejected cancellation must never notify');}}});
let handled=0;
const guarded=withAdminSession(request=>{
 handled++;
 return Response.json({id:request.headers.get('x-birkassa-user-id'),role:request.headers.get('x-birkassa-role')});
});
const request=(path='/api/auth',method='POST',body,headers={})=>new Request('https://staff.example'+path,{method,headers:{host:'staff.example',origin:'https://staff.example',...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const login=(extra={},headers={})=>auth.desktopAuthPost(request('/api/auth','POST',{userId:fixtureId,password:fixturePassword,action:'login',...extra},headers));
const allowedPath={admin:'/api/settings',manager:'/api/audit',cashier:'/api/products',warehouse:'/api/products',accountant:'/api/finance',online_manager:'/api/online-orders',online_assistant:'/api/online-orders'};
const deniedPath={manager:'/api/employees',cashier:'/api/finance',warehouse:'/api/dashboard',accountant:'/api/products',online_manager:'/api/products',online_assistant:'/api/pos-options'};
const sessionRequest=(path=allowedPath[state.user.role],method='GET',headers={})=>request(path,method,undefined,{cookie:'birkassa_session='+state.cookie,'x-birkassa-user-id':'forged-id','x-birkassa-role':'admin',...headers});
const previousLocal=process.env.BIRKASSA_LOCAL,previousNodeEnv=process.env.NODE_ENV;
try{
 process.env.BIRKASSA_LOCAL='0';process.env.NODE_ENV='production';
 for(const role of roles){
  reset(role);
  const choices=await (await auth.desktopAuthGet()).json();
  assert.equal(choices.authenticated,false);assert.equal(choices.users[0]?.role,role);
  const response=await login();
  assert.equal(response.status,200,role+' password login');
  const body=await response.json();
  assert.equal(body.authenticated,true);assert.equal(body.strongAuth,true);
  assert.equal(body.user.role,role);assert.deepEqual(body.user.permissions,policy.staffPermissions(role));
  const cookie=response.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=strict/i);assert.match(cookie,/Secure/i);
  state.cookie=cookie.match(/birkassa_session=([^;]+)/)[1];
  assert.ok(state.cookie.length>=43);assert.notEqual(state.cookie,state.tokenHash);
  assert.equal(state.passwordWrites,0);assert.equal(state.sessionsCreated,1);
  const resumed=await (await auth.desktopAuthGet()).json();
  assert.equal(resumed.authenticated,true);assert.equal(resumed.user.role,role);
  assert.equal((await auth.desktopActivity(request('/api/auth','PATCH'))).status,200);
  assert.equal(state.activityWrites,1);
  const data=await guarded(sessionRequest());
  const localOnly=mocks['@/lib/inventory-mode'].inventoryPathRequiresLocal(allowedPath[role]);
  assert.equal(data.status,localOnly?403:200,role+' web data-boundary access');
  if(localOnly){assert.equal((await data.json()).code,'INVENTORY_LOCAL_ONLY');process.env.BIRKASSA_LOCAL='1';const localData=await guarded(sessionRequest());assert.equal(localData.status,200,role+' retains local EXE access');assert.deepEqual(await localData.json(),{id:fixtureId,role});process.env.BIRKASSA_LOCAL='0';}
  else assert.deepEqual(await data.json(),{id:fixtureId,role});
  assert.match(data.headers.get('cache-control'),/no-store/);
  if(role!=='admin')assert.equal((await guarded(sessionRequest(deniedPath[role]))).status,403,role+' cannot gain another role');
  assert.equal((await guarded(sessionRequest(allowedPath[role],'POST',{origin:'https://attacker.example'}))).status,403);
  assert.equal((await auth.desktopActivity(request('/api/auth','PATCH',undefined,{origin:'https://attacker.example'}))).status,403);
  const valid={...state};
  for(const bad of [{user:{...state.user,is_active:false}},{user:{...state.user,password_hash:null}},{method:'pin'},{expired:true},{idleMinutes:10},{user:{...state.user,role:'owner'}}]){
   Object.assign(state,valid,bad);
   const before=state.activityWrites;
   assert.equal((await guarded(sessionRequest(allowedPath[role]))).status,401,role+' rejects invalid session '+JSON.stringify(Object.keys(bad)));
   assert.equal((await (await auth.desktopAuthGet()).json()).authenticated,false);
   assert.equal((await auth.desktopActivity(request('/api/auth','PATCH'))).status,401);
   assert.equal(state.activityWrites,before,'expired/weak/inactive sessions are never revived');
  }
 }
 for(const role of roles.filter(role=>role!=='admin')){
  reset(role,{password_hash:null});
  assert.deepEqual((await (await auth.desktopAuthGet()).json()).users,[],'no PIN-only staff choice');
  assert.equal((await login()).status,401,'no passwordless login');
  assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword})).status,401,'staff cannot self-bootstrap a password');
  assert.equal(state.passwordWrites,0);assert.equal(state.sessionsCreated,0);
 }
 for(const overrides of [{role:'owner'},{is_active:false}]){
  reset('admin',overrides);
  assert.equal((await login()).status,401);assert.equal(state.sessionsCreated,0);
 }
 reset('admin');
 assert.equal((await login({password:'Incorrect fixture password 123'})).status,401);
 assert.equal(state.sessionsCreated,0);
 state.attempts=5;
 const limited=await login();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 reset('admin',{password_hash:null,pin_hash:pinHash});
 assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword,pin:fixturePin})).status,401,'remote setup requires private setup token');
 assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword,setupToken:'fixture-setup-key-that-is-not-a-real-secret',pin:'000000'})).status,401,'setup requires existing PIN');
 assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword+' mismatch',setupToken:'fixture-setup-key-that-is-not-a-real-secret',pin:fixturePin})).status,401,'setup requires matching password');
 assert.equal(state.passwordWrites,0);assert.equal(state.sessionsCreated,0);
 reset('admin',{password_hash:null,pin_hash:pinHash});
 assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword,setupToken:'fixture-setup-key-that-is-not-a-real-secret',pin:fixturePin})).status,200,'correct administrator-only setup remains usable');
 assert.equal(state.passwordWrites,1);assert.equal(state.sessionsCreated,1);
 assert.equal((await login({action:'setup-password',confirmPassword:fixturePassword,setupToken:'fixture-setup-key-that-is-not-a-real-secret',pin:fixturePin})).status,401,'setup cannot overwrite an existing password');
 reset('online_assistant');state.cookie='fixture-token';state.session=true;
 const queriesBefore=state.queries.length;
 const cancel=await onlineOrders.PATCH(request('/api/online-orders','PATCH',{id:fixtureId,status:'cancelled'},{cookie:'birkassa_session=fixture-token','x-birkassa-role':'admin'}));
 assert.equal(cancel.status,403,'assistant cancellation stays blocked despite forged admin header');
 assert.equal(state.queries.length,queriesBefore+1,'cancellation is rejected before online-order database writes');
 reset('admin');
 assert.equal((await login({}, {origin:'https://attacker.example'})).status,403);
 assert.equal((await login({}, {'sec-fetch-site':'cross-site'})).status,403);
 assert.equal(state.queries.length,0);
 assert.equal((await auth.desktopAuthPost(new Request('http://staff.example/api/auth',{method:'POST'}))).status,426);
 assert.equal((await auth.desktopActivity(new Request('http://staff.example/api/auth',{method:'PATCH'}))).status,426);
 assert.equal((await guarded(request('/api/settings','GET'))).status,401);
 reset('admin');state.cookie='fixture-token';state.session=true;state.failing=true;
 const before=handled;assert.equal((await guarded(sessionRequest())).status,503);assert.equal(handled,before);
}finally{
 if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;
 if(previousNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNodeEnv;
}
console.log('PASS: seven-role exact-path/method least-privilege matrix; actual strong-password login/current-session/activity/direct-route guards; unknown/inactive/PIN-only/expired/idle sessions rejected; admin-only setup, CSRF/HTTPS, rate limiting, database failure and untrusted identity headers remain protected. No database or server used.');
