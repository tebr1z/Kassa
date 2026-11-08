import assert from 'node:assert/strict';
import {readFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
async function load(file,mocks={}){const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,compiled={exports:{}};new Function('require','module','exports',code)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),compiled,compiled.exports);return compiled.exports;}
const directory=await mkdtemp(path.join(tmpdir(),'restamarket-smtp-test-')),previous=process.env.BIRKASSA_DATA_DIR;
process.env.BIRKASSA_DATA_DIR=directory;
try{
 const config=await load('lib/smtp-config.ts');
 assert.match(await readFile('proxy.ts','utf8'),/\{prefix:'\/api\/admin\/smtp',read:\['admin'\],write:\['admin'\]\}/,'SMTP must have an explicit admin-only proxy rule, not fail-closed as an unknown route');
 const fixtureSecret='Fixture-Only-SMTP-Not-A-Real-Password';
 const cipher=await config.encryptSmtpPassword(fixtureSecret);
 assert.ok(!cipher.includes(fixtureSecret));assert.equal(await config.decryptSmtpPassword(cipher),fixtureSecret);
 const parts=cipher.split('.'),tampered=Buffer.from(parts[3],'base64');tampered[0]^=1;parts[3]=tampered.toString('base64');await assert.rejects(()=>config.decryptSmtpPassword(parts.join('.')));
 let row={enabled:false,provider:'custom',host:'',port:465,security:'tls',username:'',from_email:'',from_name:'RestaMarket',reply_to:'',password_cipher:null,revision:0,last_test_at:null,last_test_status:null,last_error_code:null};
 let addresses=[{address:'93.184.216.34',family:4}],transportOptions=[],messages=[],closed=0,verified=0,transportError=null,allowTest=true,queries=[];
 const deliveries=new Map();
 const sql={async unsafe(query,params=[]){
  queries.push([query,params]);
  if(query.startsWith('select * from smtp_settings'))return [{...row}];
  if(query.startsWith('select count(*)'))return [{failed:[...deliveries.values()].filter(d=>d.status==='failed').length}];
  if(query.startsWith('update smtp_test_rate')){if(!allowTest)return [];allowTest=false;return [{id:1}];}
  if(query.startsWith('update smtp_settings set enabled=')){const [enabled,provider,host,port,security,username,from_email,from_name,reply_to,password_cipher]=params;row={...row,enabled,provider,host,port,security,username,from_email,from_name,reply_to,password_cipher,revision:row.revision+1};return [];}
  if(query.startsWith('update smtp_settings set last_test_at=')){row.last_test_status=query.includes("'failed'")?'failed':params[0];row.last_error_code=query.includes("'failed'")?params[0]:null;return [];}
  if(query.startsWith('insert into audit_logs'))return [];
  if(query.startsWith('insert into smtp_deliveries')){if(deliveries.has(params[0]))return [];deliveries.set(params[0],{status:'sending',kind:params[1]});return [{event_key:params[0]}];}
  if(query.startsWith('update smtp_deliveries')){deliveries.set(params[0],{...deliveries.get(params[0]),status:query.includes("status='sent'")?'sent':'failed',error:params[1]});return [];}
  throw Error('Unexpected query: '+query);
 },async begin(callback){return callback(this);},async end(){}};
 const mail=await load('lib/smtp-mail.ts',{'@/lib/store-db':{storeDb:()=>sql},'@/lib/smtp-config':config,'node:dns/promises':{lookup:async()=>addresses},nodemailer:{createTransport(options){transportOptions.push(options);return {async verify(){verified++;if(transportError)throw transportError;return true;},async sendMail(message){messages.push(message);if(transportError)throw transportError;return {accepted:[message.to.address],rejected:[]};},close(){closed++;}};}}});
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.0.1','172.16.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(mail.publicSmtpAddress(ip),false,ip);
 for(const ip of ['93.184.216.34','8.8.8.8','2607:f8b0::1'])assert.equal(mail.publicSmtpAddress(ip),true,ip);
 const wrapper=handler=>async request=>{if(request.headers.get('cookie')!=='fixture-admin')return Response.json({error:'Unauthenticated'},{status:401});request.headers.set('x-birkassa-role',request.headers.get('fixture-role')||'admin');request.headers.set('x-birkassa-user-id','10000000-0000-4000-8000-000000000001');const response=await handler(request);response.headers.set('Cache-Control','private, no-store');return response;};
 const api=await load('app/api/admin/smtp/route.ts',{'@/lib/require-admin':{withAdminSession:wrapper},'@/lib/store-db':{storeDb:()=>sql},'@/lib/smtp-config':config,'@/lib/smtp-mail':mail});
 const request=(body,extra={})=>new Request('https://fixture.example/api/admin/smtp',{method:body===undefined?'GET':'POST',headers:{cookie:'fixture-admin','content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await api.GET(request(undefined,{cookie:''}))).status,401);assert.equal((await api.POST(request({action:'verify'},{'fixture-role':'cashier'}))).status,403);
 let response=await api.GET(request());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).settings.passwordConfigured,false);
 const settings={action:'save',revision:0,enabled:false,provider:'gmail',host:'smtp.gmail.com',port:465,security:'tls',username:'merchant@example.test',fromEmail:'merchant@example.test',fromName:'RestaMarket',replyTo:'',password:fixtureSecret};
 assert.equal((await api.POST(request({...settings,port:25}))).status,400);
 assert.equal((await api.POST(request({...settings,host:'https://smtp.gmail.com'}))).status,400);
 assert.equal((await api.POST(request({...settings,host:'localhost'}))).status,400);
 assert.equal((await api.POST(request({...settings,security:'starttls'}))).status,400);
 assert.equal((await api.POST(request(settings))).status,200);assert.equal(row.revision,1);assert.ok(row.password_cipher);assert.ok(!row.password_cipher.includes(fixtureSecret));
 assert.equal((await api.POST(request(settings))).status,409,'stale settings revision');
 assert.equal((await api.POST(request({...settings,revision:1,password:'',fromName:'Updated shop'}))).status,200,'blank password preserves same account');
 assert.equal((await api.POST(request({...settings,revision:2,password:'',provider:'custom',host:'other.example.test'}))).status,400,'new host cannot steal old saved credentials');
 response=await api.GET(request());const publicData=await response.json();assert.equal(publicData.settings.passwordConfigured,true);assert.ok(!JSON.stringify(publicData).includes(fixtureSecret));assert.ok(!JSON.stringify(publicData).includes('password_cipher'));
 assert.equal((await api.POST(request({action:'verify'}))).status,200);assert.equal(verified,1);assert.equal(messages.length,0,'verify does not send');
 assert.equal(transportOptions.at(-1).host,'93.184.216.34');assert.equal(transportOptions.at(-1).tls.servername,'smtp.gmail.com');assert.equal(transportOptions.at(-1).tls.rejectUnauthorized,true);assert.equal(transportOptions.at(-1).secure,true);assert.equal(transportOptions.at(-1).disableFileAccess,true);assert.equal(transportOptions.at(-1).disableUrlAccess,true);assert.equal(transportOptions.at(-1).maxRecipients,1);
 assert.equal((await api.POST(request({action:'test',to:'test@example.test'}))).status,429,'global shared cooldown persists before network');
 allowTest=true;assert.equal((await api.POST(request({action:'test',to:'test@example.test',text:'not allowed'}))).status,400,'fixed test only, no arbitrary mail content');
 assert.equal((await api.POST(request({action:'test',to:'test@example.test'}))).status,200);assert.equal(messages.length,1);assert.match(messages[0].subject,/SMTP/);assert.equal(closed,2);
 addresses=[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}];allowTest=true;assert.equal((await api.POST(request({action:'verify'}))).status,502);assert.equal(row.last_error_code,'SMTP_HOST');assert.equal(transportOptions.length,2,'mixed/private DNS never creates transport');
 addresses=[{address:'93.184.216.34',family:4}];transportError=Object.assign(Error('Provider says '+fixtureSecret),{code:'EAUTH'});allowTest=true;response=await api.POST(request({action:'verify'}));assert.equal(response.status,502);assert.ok(!(await response.text()).includes(fixtureSecret));assert.equal(row.last_error_code,'EAUTH');
 transportError=null;
 const event={eventKey:'order-cancelled:10000000-0000-4000-8000-000000000001',kind:'order_cancelled',to:'customer@example.test',subject:'Order cancelled',text:'Reason from the committed order'};
 const before=messages.length;await mail.notifyCustomerEmail(event);assert.equal(messages.length,before,'disabled SMTP sends nothing');
 row.enabled=true;await mail.notifyCustomerEmail(event);await mail.notifyCustomerEmail(event);assert.equal(messages.length,before+1,'stable event id suppresses repeated sends');assert.equal(deliveries.get(event.eventKey).status,'sent');
 transportError=Object.assign(Error('Authentication '+fixtureSecret),{code:'EAUTH'});const failed={...event,eventKey:'support-reply:20000000-0000-4000-8000-000000000002',kind:'support_reply'};await assert.doesNotReject(()=>mail.notifyCustomerEmail(failed));assert.equal(deliveries.get(failed.eventKey).status,'failed');assert.equal(deliveries.get(failed.eventKey).error,'EAUTH');
 assert.ok(!JSON.stringify(queries.filter(([q])=>q.startsWith('insert into audit_logs')||q.includes('smtp_deliveries'))).includes(fixtureSecret),'mail/audit logs contain safe metadata only');
 const oversized=new Request('https://fixture.example/api/admin/smtp',{method:'POST',headers:{cookie:'fixture-admin','content-type':'application/json'},body:JSON.stringify({action:'test',to:'x'.repeat(9000)})});assert.equal((await api.POST(oversized)).status,413,'actual body bytes bounded without Content-Length');
 console.log('PASS: encrypted SMTP credentials, safe public DTOs, revision/identity checks, public-only pinned DNS, strict TLS, fixed verify/test with shared cooldown, sanitized failures and once-per-event postcommit notifications.');
}finally{
 if(previous===undefined)delete process.env.BIRKASSA_DATA_DIR;else process.env.BIRKASSA_DATA_DIR=previous;
 await unlink(path.join(directory,'.private','smtp-encryption.key')).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(path.join(directory,'.private')).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);
}
