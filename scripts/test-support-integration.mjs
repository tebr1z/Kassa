import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// Disposable Windows PostgreSQL cluster only. There is no Next server, SMTP
// connection, real customer data, production URL, credential or external call.
const port=55449,probe=createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));});
const dataRoot=path.resolve('.local-desktop-data','support-'+randomUUID());
const previousBin=process.env.BIRKASSA_BUNDLED_PG_BIN,previousLocal=process.env.BIRKASSA_LOCAL;
process.env.BIRKASSA_LOCAL='0';
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const database=await openLocalDatabase(dataRoot,process.cwd(),{port});
assert.equal(new URL(database.url).hostname,'127.0.0.1');assert.equal(new URL(database.url).port,String(port));
const sql=postgres(database.url,{max:4,prepare:false,connect_timeout:5});
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const source=await readFile(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const db={storeDb:()=>postgres(database.url,{max:1,prepare:false,connect_timeout:5})};
const security=await load('lib/admin-security.ts'),roles=await load('lib/staff-access.ts');
const guard=await load('lib/require-admin.ts',{'@/lib/store-db':db,'@/lib/admin-security':security,'@/lib/staff-access':roles,'@/lib/inventory-mode':await load('lib/inventory-mode.ts')});
const contact=await load('lib/customer-contact.ts');
let account,mailFailure=false,urlFailure=false;
const mail=[];
const support=await load('app/api/store-admin/chat/route.ts',{'@/lib/store-db':db,'@/lib/require-admin':guard,'@/lib/seo':{siteUrl:()=>{if(urlFailure)throw Error('Fixture bad site config');return 'https://restamarket.az';}},'@/lib/smtp-mail':{notifyCustomerEmail:async notification=>{
 const id=notification.eventKey.slice('support-reply:'.length),[committed]=await sql.unsafe("select id from support_ticket_messages where id=$1 and sender='staff'",[id]);
 assert.ok(committed,'Independent SQL sees the reply before notification: transaction has committed');mail.push(notification);if(mailFailure)throw Error('Fixture SMTP unavailable');
}}});
const customers=await load('app/api/account-chat/route.ts',{'@/lib/store-db':db,'@/lib/customer-session':{customerAccount:async()=>account}});
const guest=await load('app/api/contact/route.ts',{'@/lib/store-db':db,'@/lib/customer-session':{customerAccount:async()=>null},'@/lib/customer-contact':contact});
const token='isolated-support-'+randomUUID(),digest=value=>createHash('sha256').update(value).digest('hex');
const request=(body,query='',extra={})=>new Request('https://staff.example/api/store-admin/chat'+query,{method:body===undefined?'GET':'POST',headers:{host:'staff.example',origin:'https://staff.example','content-type':'application/json',cookie:'birkassa_session='+token,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
async function admin(body,query='',expected=200,extra={}){const response=await support[body===undefined?'GET':'POST'](request(body,query,extra)),data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));assert.match(response.headers.get('cache-control'),/private, no-store/);return data;}
async function customer(body,expected=200){const response=await customers.POST(new Request('https://staff.example/api/account-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})),data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;}
async function row(id){const [ticket]=await sql.unsafe('select *,customer_revision::text as "customerRevision",staff_read_revision::text as "readRevision" from support_tickets where id=$1',[id]);return ticket;}
async function summary(){return (await admin(undefined,'?summary=1')).attention;}
async function detail(id){return (await admin(undefined,'?ticket='+id)).ticket;}
try{
 const [{server_version:version}]=await sql.unsafe('show server_version');
 const [staff]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1");await sql.unsafe("update users set password_hash='fixture-not-a-login-password' where id=$1",[staff.id]);
 await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[staff.id,digest(token)]);
 const [person]=await sql.unsafe("insert into customers(full_name,phone) values('Support fixture customer','+994500000041') returning id");
 [account]=await sql.unsafe("insert into customer_accounts(customer_id,email,password_hash) values($1,'support-fixture@example.test','fixture-not-a-login-password') returning id,customer_id,email",[person.id]);
 for(const kind of ['problem','suggestion','order'])await customer({action:'create',subject:'Fixture '+kind,kind,message:'Only disposable fixture support content.'});
 const guestResponse=await guest.POST(new Request('https://staff.example/api/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Guest fixture',phone:'+994500000042',message:'Disposable guest contact fixture.'})}));assert.equal(guestResponse.status,200,JSON.stringify(await guestResponse.json()));
 const tickets=await sql.unsafe('select id,kind,account_id from support_tickets order by created_at,id'),problem=tickets.find(item=>item.kind==='problem'&&item.account_id),suggestion=tickets.find(item=>item.kind==='suggestion'),order=tickets.find(item=>item.kind==='order'),guestTicket=tickets.find(item=>!item.account_id);
 assert.deepEqual(await summary(),{total:4,unread:4,unanswered:4},'Both account and guest inserts trigger unread; suggestions are included');
 for(let n=0;n<3;n++){await admin(undefined);await detail(problem.id);}
 assert.equal((await row(problem.id)).readRevision,'0','List/detail GET never acknowledges content');
 const first=await detail(problem.id);assert.equal(first.customerRevision,'1');
 await customer({action:'reply',ticketId:problem.id,message:'A new customer message arrived during opening.'});
 await admin({action:'read',ticketId:problem.id,customerRevision:first.customerRevision});assert.equal((await row(problem.id)).readRevision,'1');assert.equal((await detail(problem.id)).unread,true,'A message racing an explicit open remains unread');
 const current=await detail(problem.id);await admin({action:'read',ticketId:problem.id,customerRevision:current.customerRevision});assert.equal((await detail(problem.id)).unread,false);
 await admin({action:'read',ticketId:problem.id,customerRevision:'0'});assert.equal((await row(problem.id)).readRevision,'2','Stale acknowledgement cannot move read cursor backwards');
 await admin({action:'read',ticketId:problem.id,customerRevision:'999999999999999999'},'',400);assert.equal((await row(problem.id)).readRevision,'2','Forged future revision cannot mark unseen messages read');
 await admin({action:'reply',ticketId:problem.id,message:'A staff reply from the stored account context.',to:'attacker@example.test'});
 assert.equal((await detail(problem.id)).unanswered,false);assert.equal(mail.at(-1).to,account.email);assert.equal(mail.at(-1).kind,'support_reply');assert.match(mail.at(-1).text,/https:\/\/restamarket\.az\/account/);assert.ok(!mail.at(-1).text.includes('heyet-'));assert.ok(!mail.at(-1).text.includes('attacker@example.test'));
 await admin({action:'reply',ticketId:suggestion.id,message:'Answer a suggestion without first reading it.'});assert.equal((await detail(suggestion.id)).unread,true,'Replying and reading are independent persisted concepts');assert.equal((await detail(suggestion.id)).unanswered,false);
 await customer({action:'reply',ticketId:suggestion.id,message:'Another suggestion response from the customer.'});let suggested=await row(suggestion.id);assert.equal(suggested.customerRevision,'2');assert.equal((await detail(suggestion.id)).unanswered,true);
 const [lastCustomer]=await sql.unsafe("select id,body from support_ticket_messages where ticket_id=$1 and sender='customer' order by created_at desc,id desc limit 1",[suggestion.id]);
 await customer({action:'edit',messageId:lastCustomer.id,message:'The customer edited the last suggestion message.'});assert.equal((await row(suggestion.id)).customerRevision,'3','Customer body edits become unread too');
 await customer({action:'edit',messageId:lastCustomer.id,message:'The customer edited the last suggestion message.'});assert.equal((await row(suggestion.id)).customerRevision,'3','No-op edits do not manufacture new activity');
 await admin({action:'status',ticketId:suggestion.id,status:'answered'});assert.equal((await detail(suggestion.id)).unanswered,true,'A manual answered label cannot fake a staff response');
 await admin({action:'status',ticketId:suggestion.id,status:'closed'});assert.equal((await detail(suggestion.id)).unanswered,false);assert.equal((await detail(suggestion.id)).unread,true,'Closing resolves awaiting state without pretending content was read');
 await admin({action:'reply',ticketId:suggestion.id,message:'Blocked closed reply.'},'',400);await admin({action:'status',ticketId:suggestion.id,status:'open'});assert.equal((await detail(suggestion.id)).unanswered,true);
 const viewed=await detail(suggestion.id);
 await Promise.all([admin({action:'read',ticketId:suggestion.id,customerRevision:viewed.customerRevision}),customer({action:'reply',ticketId:suggestion.id,message:'A concurrent arrival after the displayed revision.'})]);assert.equal((await detail(suggestion.id)).unread,true,'Actual concurrent SQL read/update locking preserves a racing customer message');
 mailFailure=true;await admin({action:'reply',ticketId:order.id,message:'Reply remains successful when SMTP fails.'});mailFailure=false;
 urlFailure=true;await admin({action:'reply',ticketId:order.id,message:'Reply remains successful when the public URL config fails.'});urlFailure=false;
 const [staffLine]=await sql.unsafe("select id from support_ticket_messages where ticket_id=$1 and sender='staff' order by created_at desc,id desc limit 1",[order.id]);const mailBefore=mail.length;
 await admin({action:'edit',messageId:staffLine.id,message:'A corrected final staff reply.'});assert.equal(mail.length,mailBefore,'Editing does not emit a second reply email');
 await customer({action:'reply',ticketId:order.id,message:'A newer customer reply prevents stale staff editing.'});await admin({action:'edit',messageId:staffLine.id,message:'Must not overwrite old staff context.'},'',400);
 const beforeGuestMail=mail.length;await admin({action:'reply',ticketId:guestTicket.id,message:'Guest handling is retained in ticket history.'});assert.equal(mail.length,beforeGuestMail,'A guest recipient cannot be invented from request input');
 // A transaction started before a staff response may insert its next customer
 // message afterwards. clock_timestamp(), unlike now(), orders it correctly.
 const delayed=postgres(database.url,{max:1,prepare:false});
 try{await delayed.begin(async tx=>{await tx.unsafe('select now()');await admin({action:'reply',ticketId:problem.id,message:'Staff responds while the other transaction is open.'});await tx.unsafe('select pg_sleep(0.02)');await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer','Inserted after the staff answer, despite an earlier transaction start.')",[problem.id]);});}finally{await delayed.end({timeout:2});}
 assert.equal((await detail(problem.id)).unanswered,true,'Last actual customer insertion, not transaction start, determines awaiting state');
 const [defaults]=await sql.unsafe("select column_default from information_schema.columns where table_name='support_ticket_messages' and column_name='created_at'");assert.match(defaults.column_default,/clock_timestamp/);
 await sql.unsafe("with made as(insert into support_tickets(ticket_no,account_id,subject,kind) select nextval('support_ticket_seq')::text,$1,'Bulk suggestion fixture','suggestion' from generate_series(1,230) returning id) insert into support_ticket_messages(ticket_id,sender,body) select id,'customer','Unread suggestion fixture.' from made",[account.id]);
 const counts=await summary();assert.equal(counts.total,234);assert.ok(counts.unread>=230);assert.ok(counts.unanswered>=230,'Counts include every ticket, not only old200-row list cap');
 const list=await admin(undefined,'?filter=suggestion&page=2');assert.equal(list.tickets.length,50);assert.equal(list.total,231);assert.equal(list.pages,5);assert.ok(list.tickets.every(ticket=>ticket.kind==='suggestion'));assert.deepEqual(list.attention,counts);
 await admin(undefined,'?filter=unapproved',400);await admin(undefined,'?page=-1',400);await admin(undefined,'?ticket=not-a-uuid',400);
 await admin(undefined,'?summary=1',401,{cookie:'','x-birkassa-role':'admin','x-birkassa-user-id':staff.id});
 await admin({action:'read',ticketId:problem.id,customerRevision:'1'},'',403,{origin:'https://attacker.example'});
 for(const role of ['manager','cashier','warehouse','accountant','online_manager','online_assistant']){
  const [user]=await sql.unsafe("insert into users(branch_id,full_name,role,password_hash) values($1,'Support role fixture',$2,'fixture-not-a-login-password') returning id",[staff.branch_id,role]);const roleToken=randomUUID();await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[user.id,digest(roleToken)]);await admin(undefined,'?summary=1',403,{cookie:'birkassa_session='+roleToken,'x-birkassa-role':'admin'});
 }
 await sql.unsafe("update auth_sessions set authentication_method='pin' where token_hash=$1",[digest(token)]);await admin(undefined,'?summary=1',401);
 await sql.unsafe("update auth_sessions set authentication_method='password',last_seen_at=now()-interval '11 minutes' where token_hash=$1",[digest(token)]);await admin(undefined,'?summary=1',401);
 console.log('PASS: isolated PostgreSQL '+version+' support migration/trigger, real read-only snapshot and admin API SQL, persistent revision/read race, customer inserts/edits, all-ticket suggestion counts/pagination, last-sender semantics, chronological waiting transaction, post-commit email isolation, guest handling, strong admin-only auth/CSRF/idle/PIN. No web server or external request.');
}finally{
 await sql.end({timeout:2});await database.close();
 if(previousBin===undefined)delete process.env.BIRKASSA_BUNDLED_PG_BIN;else process.env.BIRKASSA_BUNDLED_PG_BIN=previousBin;
 if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;
}
