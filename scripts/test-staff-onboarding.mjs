import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {scryptSync} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
async function load(file,mocks={}){const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,loaded={exports:{}};new Function('require','module','exports',code)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;}
const policy=await load('lib/staff-access.ts'),security=await load('lib/admin-security.ts'),passwords=await load('lib/staff-password.ts'),forms=await load('lib/staff-onboarding.ts'),labels=await load('lib/staff-labels.ts'),inventory=await load('lib/inventory-mode.ts');
// The connection factory below is mocked; never use an ambient real DB URL.
const originalDatabaseUrl=process.env.DATABASE_URL,originalLocal=process.env.BIRKASSA_LOCAL;
try{
process.env.DATABASE_URL='mock://staff-onboarding-no-network';process.env.BIRKASSA_LOCAL='0';
const actorId='10000000-0000-4000-8000-000000000001',branchId='20000000-0000-4000-8000-000000000001',password='Isolated-Staff-123!';
const users=[],audit=[],revoked=[];let actorRole='admin',mutations=0;
const sql={async unsafe(query,params=[]){
 if(query.startsWith('select u.id,u.role from auth_sessions'))return [{id:actorId,role:actorRole}];
 if(query.startsWith('select id from branches'))return [{id:branchId}];
 if(query.startsWith('insert into users')){mutations++;const row={id:'30000000-0000-4000-8000-'+String(users.length+1).padStart(12,'0'),full_name:params[1],role:params[2],pin_hash:params[3],password_hash:params[4],is_active:true};users.push(row);return [{id:row.id}];}
 if(query.startsWith('select id,role from users'))return users.filter(user=>user.id===params[0]).map(({id,role})=>({id,role}));
 if(query.startsWith('update users set password_hash')){mutations++;users.find(user=>user.id===params[1]).password_hash=params[0];return [];}
 if(query.startsWith('delete from auth_sessions')){mutations++;revoked.push(params[0]);return [];}
 if(query.startsWith('insert into audit_logs')){audit.push(params);return [];}
 if(query.startsWith('select id,name,address,phone,currency,timezone from branches'))return [{id:branchId,name:'Fixture shop',currency:'AZN',timezone:'Asia/Baku'}];
 if(query.startsWith('select u.id,u.full_name,u.role,u.is_active'))return users.map(user=>({...user,has_pin:Boolean(user.pin_hash),has_password:Boolean(user.password_hash),branch_id:branchId,branch_name:'Fixture shop'}));
 if(query.startsWith('select id,name,address from branches')||query.startsWith('select w.id,w.name')||query.startsWith('select id,name,code,is_active from cash_registers')||query.startsWith('select l.id,l.code')||query.startsWith('select key,value from system_settings'))return [];
 throw Error('Unexpected mock SQL: '+query);
},async begin(callback){return callback(this);},async end(){}};
const guard=await load('lib/require-admin.ts',{'@/lib/store-db':{storeDb:()=>sql},'@/lib/admin-security':security,'@/lib/staff-access':policy,'@/lib/inventory-mode':inventory});
const next={NextResponse:{json:Response.json.bind(Response)}};
const settings=await load('app/api/settings/route.ts',{'@/lib/require-admin':guard,'@/lib/staff-password':passwords,'@/lib/log-error':{logSystemError(){}},'next/server':next,postgres:()=>sql,'@/lib/inventory-mode':inventory});
const locations=await load('app/api/locations/route.ts',{'@/lib/require-admin':guard,'@/lib/store-db':{storeDb:()=>sql},'@/lib/staff-access':policy,'@/lib/staff-password':passwords,'@/lib/inventory-mode':inventory});
const request=(path,body)=>new Request('https://fixture.example'+path,{method:'POST',headers:{host:'fixture.example',origin:'https://fixture.example',cookie:'birkassa_session=isolated-fixture','content-type':'application/json'},body:JSON.stringify(body)});
const invoke=async(handler,path,body)=>{const response=await handler(request(path,body));return {status:response.status,data:await response.json()};};
const create=(role,overrides={})=>({action:'create_user',fullName:'Isolated '+role,role,branchId,password,...overrides});
const originalConsoleError=console.error;console.error=(...args)=>{if(args[0]==='settings.post'&&args[1]?.statusCode===400)return;originalConsoleError(...args);};
for(const weak of ['', 'short1', 'abcdefghijklmnop', '123456789012', 'a'.repeat(129)]){
 const before=mutations,result=await invoke(settings.POST,'/api/settings',create('warehouse',{password:weak}));assert.equal(result.status,400);assert.equal(mutations,before,'Weak/missing password must not create a PIN-only account');assert.notEqual(forms.staffPasswordFormError(weak,weak),'');
}
console.error=originalConsoleError;
assert.notEqual(forms.staffPasswordFormError(password,password+'different'),'');assert.equal(forms.staffPasswordFormError(password,password),'');
for(const role of policy.staffRoles){
 const result=await invoke(settings.POST,'/api/settings',create(role));assert.equal(result.status,200,role);const user=users.at(-1);assert.equal(user.role,role);assert.equal(user.pin_hash,null,'An operation PIN is not silently invented');
 const [salt,hash]=user.password_hash.split(':');assert.ok(salt&&hash);assert.equal(scryptSync(password,salt,64).toString('hex'),hash,'Every role gets its own verified strong password hash');assert.ok(!JSON.stringify(result.data).includes(password));
 user.password_hash=null;user.pin_hash='fixture-pin-hash';const reset=await invoke(locations.POST,'/api/locations',{action:'password',userId:user.id,password});assert.equal(reset.status,200,'Admin may explicitly set an existing PIN-only '+role+' password');assert.ok(user.password_hash);assert.ok(revoked.includes(user.id),'Setting credentials revokes previous sessions');
}
const ready=await settings.GET(new Request('https://fixture.example/api/settings',{headers:{cookie:'birkassa_session=isolated-fixture'}}));assert.equal(ready.status,200);const json=await ready.json();assert.ok(json.users.every(user=>user.hasPassword===true));assert.ok(!JSON.stringify(json).includes('password_hash'));assert.ok(!JSON.stringify(json).includes(password));assert.ok(!JSON.stringify(audit).includes(password),'Plaintext credentials must not enter audit logs');assert.ok(!JSON.stringify(audit).includes(users[0].password_hash),'Hashes must not enter audit logs');
for(const role of policy.staffRoles.filter(role=>role!=='admin')){actorRole=role;const before=mutations;assert.equal((await invoke(settings.POST,'/api/settings',create('cashier'))).status,403);assert.equal((await invoke(locations.POST,'/api/locations',{action:'password',userId:users[0].id,password})).status,403);assert.equal(mutations,before,'Non-admin cannot provision or reset staff credentials');}actorRole='admin';
const auth=await readFile('lib/desktop-auth.ts','utf8');assert.match(auth,/password_hash is not null/,'PIN-only users remain excluded from password sign-in');
const {staffOnboardingTranslations}=await load('lib/staff-onboarding-translations.ts');for(const row of staffOnboardingTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));}
const language={'@/lib/language':{useTranslations:()=>({t:value=>value})}},button={Button:({children,...props})=>createElement('button',props,children)};
const dialog={Dialog:({children})=>children,DialogContent:()=>null,DialogTrigger:({children})=>children,DialogDescription:()=>null,DialogHeader:()=>null,DialogTitle:()=>null};
const setup=await load('app/admin/staff-password-setup.tsx',{...language,'@/lib/staff-onboarding':forms,'@/components/ui/dialog':dialog,'@/components/ui/button':button,'./staff-access-settings.css':{}});
const {default:StaffAccessSettings}=await load('app/admin/staff-access-settings.tsx',{...language,'@/lib/staff-labels':labels,'@/lib/staff-onboarding':forms,'@/components/ui/button':button,'./staff-password-setup':setup,'./staff-access-settings.css':{}});
const html=renderToStaticMarkup(createElement(StaffAccessSettings,{users:[{id:'pin-only',fullName:'Warehouse fixture',role:'warehouse',isActive:true,hasPin:true,hasPassword:false},{id:'ready',fullName:'Cashier fixture',role:'cashier',isActive:true,hasPin:false,hasPassword:true}],branches:[{id:branchId,name:'Fixture shop'}],onChanged:async()=>{}}));assert.ok(html.includes('Veb girişi hazır deyil'));assert.ok(html.includes('Veb girişi hazırdır'));assert.ok(html.includes('Şifrə qur'));assert.ok(html.includes('Şifrəni dəyiş'));assert.match(html,/<input(?=[^>]*name="password")(?=[^>]*type="password")(?=[^>]*required)[^>]*>/);assert.ok(!html.includes(password));
console.log('PASS: all7 roles provision with explicit strong hashed passwords, PIN-only reset admin-only/revokes sessions, safe ready DTO/audit, five-language copy and actionable readiness/password UI. Mock database only; no server/live data.');
}finally{if(originalDatabaseUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=originalDatabaseUrl;if(originalLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=originalLocal;}
