import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Pure helper and real guest-contact handler tests, with a strict SQL adapter.
// No database, customer records, SMS, browser or external service is accessed.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const compiledModule={exports:{}};
 new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);
 return compiledModule.exports;
}
const contact=await load('lib/customer-contact.ts');
const browserPattern=new RegExp('^(?:'+contact.customerPhonePattern+')$','v');
const goodPhones=[
 ['0501234567','+994501234567'],['(050) 123-45-67','+994501234567'],
 ['+994 (50) 123-45-67','+994501234567'],['00994 50 123 45 67','+994501234567'],
 ['994501234567','+994501234567'],['501234567','+994501234567'],
 ['0102391620','+994102391620'],['0518991605','+994518991605'],
 ['0552100001','+994552100001'],['0607009934','+994607009934'],
 ['0702000613','+994702000613'],['0771234567','+994771234567'],['0995955268','+994995955268'],
 ['0501111111','+994501111111'],['0555555555','+994555555555'],['+994500000001','+994500000001'],
 ['(012) 598-58-58','+994125985858'],['0186442199','+994186442199'],
 ['0202052199','+994202052199'],['0214280020','+994214280020'],['0222572199','+994222572199'],
 ['0233352199','+994233352199'],['0242442199','+994242442199'],['0252552199','+994252552199'],
 ['0263155000','+994263155000'],['0365446300','+994365446300'],['0464500003','+994464500003'],['0882351479','+994882351479'],
 ['+90 (532) 123-45-67','+905321234567'],['0090 532 123 45 67','+905321234567'],
 ['+7 916 123 45 67','+79161234567'],['+86 138 0013 8000','+8613800138000'],['+1 (212) 555-0123','+12125550123'],
];
for(const [raw,canonical]of goodPhones)for(const phone of [raw,' '+raw+' ']){
 assert.equal(contact.isCustomerPhone(phone),true,phone);
 assert.equal(contact.normalizeCustomerPhone(phone),canonical,phone);
 assert.equal(contact.customerPhoneError(phone),'');
 assert.equal(browserPattern.test(phone.trim()),true,'Browser v-pattern accepts each valid formatted phone');
}
const badPhones=['',' ','1234567','123456789012345','050123456','05012345678','0961234567','0131234567','+994401234567','+99450123456','+9945012345678','0500000000','0510000000','0550000000','0700000000','0770000000','0990000000','0120000000','0000000000','+000000000000','+10000000000','+994 (0) 50 1234567','050+1234567','++994501234567','+994/50/1234567','+994501234567abc','+994\u00a0501234567','+994\t501234567','٠٥٠١٢٣٤٥٦٧','+1234567890123456'];
for(const phone of badPhones){assert.equal(contact.isCustomerPhone(phone),false,JSON.stringify(phone));assert.equal(contact.normalizeCustomerPhone(phone),null);assert.match(contact.customerPhoneError(phone),/050 123 45 67/);}

const goodAddresses=[
 'Nizami küçəsi','Bakı, Nizami küçəsi 10','Bakı ş., Səməd Vurğun küç. 12/4',
 'Xırdalan, Heydər Əliyev prospekti','Novxanı qəsəbəsi','28 May küçəsi','8-ci mikrorayon',
 'Dadaş Dadaşov küçəsi','Əhməd Rəcəbli','Qara Qarayev prospekti','Atatürk prospekti',
 'Баку, улица Низами','Сумгаит, 9-й микрорайон','Bakü, İstiklal Caddesi',
 'Baku, Nizami Street','Baku, O’Connell Street','巴库尼扎米街十号',
 '  Bakı,\n  Nizami küçəsi\t10  ',
];
for(const address of goodAddresses){
 assert.equal(contact.isCustomerAddress(address,{required:true}),true,address);
 assert.equal(contact.customerAddressError(address,{required:true}),'');
}
assert.equal(contact.normalizeCustomerAddress('  Bakı,\n Nizami küçəsi\t10  '),'Bakı, Nizami küçəsi 10');
for(const address of ['', '  ', '\n\t']){
 assert.equal(contact.isCustomerAddress(address),true,'An optional account address may remain blank');
 assert.equal(contact.isCustomerAddress(address,{required:true}),false,'Delivery still requires a meaningful address');
 assert.notEqual(contact.customerAddressError(address,{required:true}),'');
}
const badAddresses=['sadasdasdas','asdasdasdasd','asdfghjkl','qwertyuiop','qwertyqwerty','zxcvbnm','аааааааа','aaaaaaa','abcabcabc','Bakı Bakı Bakı','test','Test ünvanı 123','TEST ADDRESS','тестовый адрес 123','测试地址','1234567890','1 2 3 4 5','......','a b c','Bakı, https://example.com','www.example.az','user@example.com','example.com/address','<script>alert(1)</script>','Nizami\u200b küçəsi'];
for(const address of badAddresses){assert.equal(contact.isCustomerAddress(address,{required:true}),false,address);assert.match(contact.customerAddressError(address,{required:true}),/Bakı, Nizami küçəsi 10/);}
assert.equal(contact.isCustomerAddress('Nizami küçəsi',{maxLength:5}),false);
assert.equal(contact.isCustomerAddress('Nizami küçəsi',{maxLength:13}),true);

let calls=[],phoneSaved,authReads=0;
const db={async unsafe(query,params=[]){
 calls.push({query,params});
 if(query.includes('pg_advisory_xact_lock'))return [];
 if(query.startsWith('select count(*)::int n from support_tickets'))return [{n:0}];
 if(query.includes("nextval('support_ticket_seq')"))return [{ticket_no:'CONTACT-VALIDATION'}];
 if(query.startsWith('insert into support_tickets')){phoneSaved=params[3];return [{id:'10000000-0000-4000-8000-000000000001'}];}
 if(query.startsWith('insert into support_ticket_messages'))return [];
 throw Error('Unexpected contact fixture SQL: '+query);
},async begin(callback){return callback(this);},async end(){}};
const route=await load('app/api/contact/route.ts',{
 '@/lib/customer-contact':contact,'@/lib/store-db':{storeDb:()=>db},
 '@/lib/customer-session':{customerAccount:async()=>{authReads++;return null;}},
});
const post=phone=>route.POST(new Request('https://fixture.example/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Aysel Məmmədova',phone,message:'Məhsul barədə məlumat istəyirəm.'})}));
for(const phone of badPhones){calls=[];authReads=0;const response=await post(phone);assert.equal(response.status,400,JSON.stringify(phone));assert.equal((await response.json()).error,contact.customerPhoneError(phone));assert.equal(calls.length,0,'Invalid guest contact does not write tickets or rate-limit state');assert.equal(authReads,0);}
for(const [phone,canonical]of goodPhones){calls=[];const response=await post(phone);assert.equal(response.status,200,phone);assert.equal(phoneSaved,canonical);assert.equal(calls.find(call=>call.query.includes('pg_advisory_xact_lock')).params[0],canonical,'Different formatted contacts share the same anti-spam key');}

const {customerContactTranslations}=await load('lib/customer-contact-translations.ts');
const errorKeys=[contact.customerPhoneError(''),contact.customerAddressError('',{required:true})];
assert.deepEqual(customerContactTranslations.map(row=>row[0]),errorKeys);
for(const row of customerContactTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));}
console.log('PASS: AZ 2026 mobile/landline formats, explicit foreign international phones, canonicalization, zero fillers without blocking premium numbers, moderate multilingual/optional address validation, guest contact handler parity and five-language example errors. Mock-only: no SMS, customer data or provider requests.');
