import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const source=await readFile('lib/staff-portal.ts','utf8');
const portal=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
export const {STAFF_PORTAL_PATH,staffPortalPath}=portal;
const roles=['admin','cashier','warehouse','accountant','manager','online_manager','online_assistant'];

export async function verifyStaffPortalPolicy(){
 assert.match(STAFF_PORTAL_PATH,/^\/[a-z0-9-]+$/);
 assert.notEqual(STAFF_PORTAL_PATH,'/admin');
 assert.equal(staffPortalPath(),STAFF_PORTAL_PATH);
 for(const role of roles){
  assert.equal(portal.canOpenStaffPage(role,STAFF_PORTAL_PATH),true,'Unified staff entry: '+role);
  assert.equal(portal.canOpenStaffPage(role,staffPortalPath('/store')),role==='admin','Store administration remains admin-only');
  assert.equal(portal.canOpenStaffPage(role,staffPortalPath('/online')),['admin','manager','online_manager','online_assistant'].includes(role));
  assert.equal(portal.canOpenStaffPage(role,STAFF_PORTAL_PATH+'/not-a-page'),false);
 }
 for(const path of ['/admin','/admin/store','/admin/online',STAFF_PORTAL_PATH+'-fake','/something'+STAFF_PORTAL_PATH])assert.equal(portal.isStaffPortalPath(path),false,path);
 for(const path of [STAFF_PORTAL_PATH,staffPortalPath('/store'),staffPortalPath('/online')])assert.equal(portal.isStaffPortalPath(path),true,path);
 for(const name of ['staff-dashboard','store/store-page','online/online-page'])await access('app/admin/'+name+'.tsx');
 for(const name of ['page','store/page','online/page']){
  await assert.rejects(access('app/admin/'+name+'.tsx'),{code:'ENOENT'},'Legacy page must not remain routable: '+name);
 }
 const folder='app'+STAFF_PORTAL_PATH;
 for(const page of ['page.tsx','store/page.tsx','online/page.tsx','layout.tsx'])await access(folder+'/'+page);
 const layout=await readFile(folder+'/layout.tsx','utf8');assert.match(layout,/metadata|privateRobots/,'New route inherits private indexing policy');
 const proxy=await readFile('proxy.ts','utf8');assert.ok(proxy.includes('"'+STAFF_PORTAL_PATH+'/:path*"')||proxy.includes("'"+STAFF_PORTAL_PATH+"/:path*'"),'Proxy matcher must contain a literal statically-analyzable staff path');
 assert.ok(!proxy.includes('NextResponse.rewrite('),'The portal must not depend on a caller-spoofable internal rewrite marker');
 console.log('PASS: unlisted staff entry and exact page permissions, literal Proxy coverage, real hidden wrappers, and no remaining legacy page routes.');
}

// This is called only by test-web-admin's freshly-created isolated DB/server.
// It creates no real accounts, performs no sales, and does not contact live hosts.
export async function verifyStaffPortalHttp({origin,request,sql,admin,adminSession,password,setSession,inventoryLocal=false}){
 const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5767');
 const legacy=['/admin','/admin/','/admin/store','/admin/store/','/admin/online','/admin/online/'];
 for(const auth of [false,true]){
  setSession(adminSession);
  for(const path of legacy){
   const result=await request(path,{auth,headers:{'x-birkassa-user-id':admin.id,'x-birkassa-role':'admin'}});
   assert.equal(result.status,404,'Legacy entry stays absent even with a valid/forged identity: '+path);
   assert.equal(result.headers.get('location'),null,'Old URLs must not disclose the unlisted replacement');
   assert.ok(!String(result.data).includes(STAFF_PORTAL_PATH),'Old 404 body must not disclose the replacement');
  }
 }
 const rsc=await request('/admin/store?_rsc=staff-portal-test',{auth:false,headers:{RSC:'1','Next-Router-Prefetch':'1'}});assert.equal(rsc.status,404);assert.equal(rsc.headers.get('location'),null);
 const loginPage=await request(STAFF_PORTAL_PATH,{auth:false});assert.equal(loginPage.status,200);assert.match(loginPage.headers.get('cache-control'),/no-store/);assert.match(loginPage.headers.get('x-robots-tag'),/noindex/);assert.match(loginPage.data,/<meta name="robots" content="noindex/);
 for(const path of [staffPortalPath('/store'),staffPortalPath('/online')]){
  const result=await request(path,{auth:false});assert.equal(result.status,307);assert.equal(new URL(result.headers.get('location'),origin).pathname,STAFF_PORTAL_PATH);
 }
 setSession(adminSession);for(const auth of [false,true])for(const path of [STAFF_PORTAL_PATH+'/not-a-page',staffPortalPath('/store')+'/not-a-page']){const missing=await request(path,{auth});assert.equal(missing.status,404,'Unknown staff routes stay404 even when anonymous: '+path);assert.equal(missing.headers.get('location'),null);}
 for(const path of ['/','/mehsullar','/robots.txt','/sitemap.xml']){
  const response=await request(path,{auth:false});assert.equal(response.status,200);assert.ok(!String(response.data).includes(STAFF_PORTAL_PATH),'Public content must not advertise staff entry: '+path);
 }
 const matrix={
  warehouse:{nav:['Anbar'],forbiddenNav:['Satış / POS','Maliyyə','Hesabatlar','Tənzimləmələr'],allowed:['/api/products','/api/warehouses'],denied:['/api/dashboard','/api/finance','/api/reports','/api/settings','/api/locations','/api/store-admin/commerce']},
  accountant:{nav:['Maliyyə','Hesabatlar'],forbiddenNav:['Satış / POS','Anbar','Tənzimləmələr'],allowed:['/api/finance','/api/reports'],denied:['/api/products','/api/stock','/api/settings','/api/locations','/api/store-admin/commerce']},
  manager:{nav:['İdarə paneli','Hesabatlar'],forbiddenNav:['Tənzimləmələr','Mağazalar və kassirlər','İnsan resursları'],allowed:['/api/products','/api/dashboard','/api/reports','/api/audit'],denied:['/api/settings','/api/locations','/api/employees','/api/system?view=backups','/api/store-admin/commerce']},
  online_manager:{nav:[],forbiddenNav:['Satış / POS','Maliyyə','Anbar','Tənzimləmələr'],allowed:['/api/online-orders'],denied:['/api/products','/api/dashboard','/api/finance','/api/settings','/api/locations']},
  online_assistant:{nav:[],forbiddenNav:['Satış / POS','Maliyyə','Anbar','Tənzimləmələr'],allowed:['/api/online-orders'],denied:['/api/products','/api/dashboard','/api/finance','/api/settings','/api/locations']},
 };
 try{
  const provisioned=new Map();
  for(const role of roles){
   setSession(adminSession);const created=await request('/api/settings',{method:'POST',body:{action:'create_user',fullName:'İzolə edilmiş '+role,role,branchId:admin.branch_id,password}});assert.equal(created.status,200,'Admin provisions strong web password via real settings API for '+role+': '+JSON.stringify(created.data));provisioned.set(role,{id:created.data.id});
   const state=await request('/api/auth',{auth:false});assert.ok(state.data.users.some(user=>user.id===created.data.id&&user.hasPassword),'New '+role+' is available for password sign-in');
  }
  for(const role of ['admin','cashier']){
   const signed=await request('/api/auth',{method:'POST',auth:false,body:{action:'login',userId:provisioned.get(role).id,password}});assert.equal(signed.status,200);assert.equal(signed.data.user.role,role);assert.equal((await request('/api/settings')).status,role==='admin'?200:403);assert.equal((await request('/api/auth',{method:'DELETE'})).status,200);
  }
  setSession(adminSession);
  const [pinOnly]=await sql.unsafe("insert into users(branch_id,full_name,role,pin_hash) select branch_id,'İzolə edilmiş PIN-only anbardar','warehouse',pin_hash from users where id=$1 returning id",[admin.id]);
  assert.ok(!(await request('/api/auth',{auth:false})).data.users.some(user=>user.id===pinOnly.id),'PIN-only staff must not appear as password-ready');
  assert.equal((await request('/api/settings')).data.users.find(user=>user.id===pinOnly.id).hasPassword,false,'Settings explicitly exposes the unready status, not a hash');
  assert.equal((await request('/api/locations',{method:'POST',body:{action:'password',userId:pinOnly.id,password}})).status,200,'Only the admin explicitly sets the existing staff password');
  assert.ok((await request('/api/auth',{auth:false})).data.users.some(user=>user.id===pinOnly.id&&user.hasPassword),'Explicitly configured staff now appear for password sign-in');
  assert.equal((await request('/api/auth',{method:'POST',auth:false,body:{action:'login',userId:pinOnly.id,password}})).status,200);assert.equal((await request('/api/warehouses')).status,inventoryLocal?200:403);assert.equal((await request('/api/finance')).status,403,'Onboarding does not elevate warehouse permissions');assert.equal((await request('/api/auth',{method:'DELETE'})).status,200);
  for(const [role,policy] of Object.entries(matrix)){
   setSession(adminSession);
   const staff=provisioned.get(role);
   const signed=await request('/api/auth',{method:'POST',auth:false,body:{action:'login',userId:staff.id,password}});
   assert.equal(signed.status,200,'Password login for '+role+': '+JSON.stringify(signed.data));assert.equal(signed.data.user.role,role);
   const permissions=signed.data.user.permissions;assert.ok(Array.isArray(permissions),'Role has an explicit navigation policy: '+role);assert.ok(!permissions.includes('*'),'Non-admin is not a wildcard administrator');if(role.startsWith('online_'))assert.deepEqual(permissions,[],'Online staff use the separate order workspace, not POS navigation');else assert.ok(permissions.length);
   for(const label of policy.nav)assert.ok(permissions.includes(label),role+' should see '+label);
   for(const label of policy.forbiddenNav)assert.ok(!permissions.includes(label),role+' must not see '+label);
   assert.equal((await request(STAFF_PORTAL_PATH)).status,200,'Unified login/dashboard entry for '+role);
   const store=await request(staffPortalPath('/store'));assert.ok([307,404].includes(store.status),'Store settings denied to '+role);if(store.status===307)assert.equal(new URL(store.headers.get('location'),origin).pathname,STAFF_PORTAL_PATH);
   if(['manager','online_manager','online_assistant'].includes(role))assert.equal((await request(staffPortalPath('/online'))).status,200);
   for(const endpoint of policy.allowed){
    const result=await request(endpoint),expected=inventoryLocal||endpoint==='/api/online-orders'?200:403;assert.equal(result.status,expected,role+' runtime capability '+endpoint+': '+JSON.stringify(result.data));assert.match(result.headers.get('cache-control'),/no-store/);
    if(endpoint==='/api/online-orders'){assert.equal(result.data.canManage,true);assert.equal(result.data.canCancel,role!=='online_assistant');}
    if(result.status===200&&endpoint==='/api/products'&&['warehouse','manager'].includes(role)){
     const [fixtureProduct]=await sql.unsafe("select id from products where sku='VARIANT-NEW-01' and is_active=true and deleted_at is null");assert.ok(fixtureProduct,'Use only the variant fixture created by test-web-admin');
     const product=result.data.find(item=>item.id===fixtureProduct.id);assert.ok(product);assert.equal(product.options.length,2);
     assert.ok(Array.isArray(product.editableOptions),'Authorized inventory editor must receive existing choices: '+role);
     for(const option of product.options){const editable=product.editableOptions.find(item=>item.id===option.id);assert.ok(editable,'Editing cannot silently drop an existing choice: '+role);assert.equal(editable.is_active,true);assert.deepEqual(editable.attributes,option.attributes);assert.ok(Object.hasOwn(editable,'cost_price'));}
     const [before]=await sql.unsafe('select is_active,deleted_at from products where id=$1',[fixtureProduct.id]);const [auditBefore]=await sql.unsafe('select count(*)::int n from audit_logs where entity_id=$1',[fixtureProduct.id]);
     assert.equal((await request('/api/products',{method:'PATCH',body:{action:'deactivate',productId:fixtureProduct.id}})).status,403,'Non-admin product deactivation denied at the operation boundary: '+role);
     assert.deepEqual((await sql.unsafe('select is_active,deleted_at from products where id=$1',[fixtureProduct.id]))[0],before,'Rejected deactivation cannot mutate the fixture');
     assert.equal((await sql.unsafe('select count(*)::int n from audit_logs where entity_id=$1',[fixtureProduct.id]))[0].n,auditBefore.n,'Rejected deactivation cannot add an archive audit entry');
    }
   }
   for(const endpoint of policy.denied)assert.equal((await request(endpoint)).status,403,role+' denied '+endpoint);
   assert.equal((await request('/api/settings',{headers:{'x-birkassa-user-id':admin.id,'x-birkassa-role':'admin'}})).status,403,'Forged admin headers cannot elevate '+role);
   assert.equal((await request('/api/settings',{method:'POST',body:{action:'rules'},headers:{Origin:'https://attacker.example','x-birkassa-role':'admin'}})).status,403,'Cross-origin mutation denied for '+role);
   assert.equal((await request('/api/auth',{method:'PATCH'})).status,200,'Allowed staff sessions extend only on activity: '+role);
   const issued=signed.headers.getSetCookie().find(value=>value.startsWith('birkassa_session='));assert.ok(issued);const token=issued.split(';')[0].slice('birkassa_session='.length),tokenHash=createHash('sha256').update(token).digest('hex');
   await sql.unsafe("update auth_sessions set last_seen_at=now()-interval '11 minutes' where token_hash=$1",[tokenHash]);
   assert.equal((await request(policy.allowed[0])).status,401,'Idle session is rejected: '+role);assert.equal((await request('/api/auth',{method:'PATCH'})).status,401,'An expired session cannot revive itself');
   assert.equal((await request('/api/auth')).data.authenticated,false);
   await sql.unsafe('update auth_sessions set last_seen_at=now() where token_hash=$1',[tokenHash]);
   await sql.unsafe('update users set is_active=false where id=$1',[staff.id]);
   assert.equal((await request(policy.allowed[0])).status,401,'Inactive staff denied: '+role);
   assert.equal((await request('/api/auth',{method:'POST',auth:false,body:{action:'login',userId:staff.id,password}})).status,401,'Inactive staff cannot log in: '+role);
   await sql.unsafe('update users set is_active=true where id=$1',[staff.id]);setSession(token);
   await sql.unsafe("update auth_sessions set authentication_method='pin' where token_hash=$1",[tokenHash]);
   assert.equal((await request(policy.allowed[0])).status,401,'PIN-only session cannot authorize staff APIs: '+role);assert.equal((await request('/api/auth',{method:'PATCH'})).status,401);
   await sql.unsafe("update auth_sessions set authentication_method='password',expires_at=now()-interval '1 minute' where token_hash=$1",[tokenHash]);
   assert.equal((await request(policy.allowed[0])).status,401,'Absolute session expiry denied: '+role);
   assert.equal((await request('/api/auth',{method:'DELETE'})).status,200);assert.equal((await request(policy.allowed[0])).status,401,'Logout keeps staff APIs closed: '+role);
  }
 }finally{setSession(adminSession);}
 console.log('PASS: isolated unified staff login, role navigation/API/page boundaries, preserved variant editor DTOs, admin-only deactivation without mutation, hidden legacy/unknown404 without disclosure, forged headers, CSRF, activity, expired/inactive/PIN-only sessions and logout.');
}

if(process.argv[1]?.endsWith('test-staff-portal.mjs'))await verifyStaffPortalPolicy();
