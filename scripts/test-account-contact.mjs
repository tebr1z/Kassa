import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {scryptSync} from 'node:crypto';
import ts from 'typescript';

// Execute the actual account handlers; no DB, HTTP server or live records.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const compiledModule={exports:{}};
 new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);
 return compiledModule.exports;
}
const contact=await load('lib/customer-contact.ts');
const accountId='10000000-0000-4000-8000-000000000001',customerId='20000000-0000-4000-8000-000000000001';
const fixturePassword='Fixture-Contact-123!',salt='contact-test',passwordHash=salt+':'+scryptSync(fixturePassword,salt,64).toString('hex');
let queries=[],registeredPhone,registeredAddress,updatedPhone,updatedAddress;
const db={async unsafe(query,params=[]){
 queries.push(query);
 if(query.startsWith('insert into customer_auth_attempts'))return [{attempts:1}];
 if(query.startsWith('select id,password_hash'))return [{id:accountId,password_hash:passwordHash}];
 if(query.startsWith('insert into customers')){registeredPhone=params[1];registeredAddress=params[2];return [{id:customerId}];}
 if(query.startsWith('insert into customer_accounts'))return [{id:accountId}];
 if(query.startsWith('insert into customer_sessions'))return [];
 if(query.startsWith('update customers')){updatedPhone=params[1];updatedAddress=params[2];return [];}
 throw Error('Unexpected SQL: '+query);
},async begin(callback){return callback(this);},async end(){}};
const route=await load('app/api/customer-account/route.ts',{
 'next/server':{NextResponse:{json(value,options){const response=Response.json(value,options);response.cookies={set(){}};return response;}}},
 'next/headers':{cookies:async()=>({get:()=>undefined})},
 '@/lib/customer-contact':contact,'@/lib/store-db':{storeDb:()=>db},
 '@/lib/customer-session':{customerCookie:'fixture-customer',customerAccount:async()=>({id:accountId,customer_id:customerId})},
 '@/lib/auth-cookie':{secureAuthCookie:()=>true},
});
function request(body){return new Request('https://fixture.example/api/customer-account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
const registration={action:'register',email:'contact@example.test',password:fixturePassword,name:' Aysel Məmmədova '};
const profile={name:' Aysel Məmmədova ',address:'',lat:null,lng:null};
for(const phone of ['123456','1234567890123456','+++++++','+994501234567abc','+994/50/1234567','0500000000','+994990000000','0961234567']){
 queries=[];
 assert.equal((await route.POST(request({...registration,phone}))).status,400);
 assert.equal((await route.PATCH(request({...profile,phone}))).status,400);
 assert.equal(queries.length,0,'Invalid contact must not mutate auth limits, profiles or registrations');
}
const phone='+994 (50) 123-45-67';
assert.equal((await route.POST(request({...registration,phone:' '+phone+' '}))).status,200);
assert.equal(registeredPhone,'+994501234567','Registration saves the same canonical contact used in checkout');
assert.equal(registeredAddress,'','Registration does not require an address');
assert.equal((await route.PATCH(request({...profile,phone:' '+phone+' '}))).status,200);
assert.equal(updatedPhone,'+994501234567');assert.equal(updatedAddress,'','An optional profile address can be cleared');
for(const address of ['sadasdasdas','qwertyqwerty','aaaaaaa','Test ünvanı 123','123456789','https://example.com/address']){
 queries=[];
 for(const response of [await route.POST(request({...registration,phone,address})),await route.PATCH(request({...profile,phone,address}))]){
  assert.equal(response.status,400,address);assert.equal((await response.json()).error,contact.customerAddressError(address));
 }
 assert.equal(queries.length,0,'Invalid optional addresses must be rejected before auth/profile/registration writes');
}
for(const address of ['Nizami küçəsi','Баку, улица Низами','Bakü, İstiklal Caddesi','Baku, Nizami Street','  Bakı,\n  Nizami küçəsi 10  ']){
 assert.equal((await route.POST(request({...registration,phone,address}))).status,200,address);
 assert.equal(registeredAddress,contact.normalizeCustomerAddress(address));
 assert.equal((await route.PATCH(request({...profile,phone,address}))).status,200,address);
 assert.equal(updatedAddress,contact.normalizeCustomerAddress(address));
}
queries=[];
assert.equal((await route.POST(request({action:'login',email:'existing@example.test',password:fixturePassword}))).status,200,'Existing accounts still log in without supplying a phone');
assert.ok(queries.some(query=>query.startsWith('insert into customer_sessions')));
new RegExp('^(?:'+contact.customerPhonePattern+')$','v');
for(const path of ['app/account/page.tsx','app/account-settings.tsx']){
 const source=await readFile(path,'utf8');
 assert.ok(source.includes('pattern={customerPhonePattern}'),path+' must use the HTML v-compatible pattern');
 assert.ok(source.includes('checkoutContactError('),path+' must reject invalid contacts before POST/PATCH');
 assert.ok(source.includes('useTranslations()'),path+' must render from the hydration language snapshot');
}
console.log('PASS: account/profile contact parity, v-compatible patterns, canonical phones, optional meaningful multilingual addresses, fake input rejected before writes, and existing-account login without phone. No live data used.');
