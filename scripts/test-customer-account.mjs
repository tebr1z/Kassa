import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const dataRoot=path.resolve('.local-desktop-data','customer-'+randomUUID());
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const db=await openLocalDatabase(dataRoot,process.cwd(),{port:55443});
const sql=postgres(db.url,{max:1,prepare:false}),origin='http://127.0.0.1:5764';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','5764'],{windowsHide:true,env:{...process.env,DATABASE_URL:db.url,BIRKASSA_LOCAL:'0',NODE_ENV:'production'},stdio:'ignore'});
let cookie='';
async function request(url,body,method=body?'POST':'GET',auth=true){
 const response=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth&&cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error(url+' returned non-JSON HTTP '+response.status);}
 return {response,status:response.status,data};
}
try{
 let ready=false;for(let n=0;n<80;n++){try{const r=await request('/api/auth');if(r.status===200&&typeof r.data.authenticated==='boolean'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}assert.ok(ready);
 assert.equal((await request('/api/customer-account')).data.user,null);
 assert.equal((await request('/api/my-orders')).status,401);
 const email='aysel.ui@example.test',password='Fixture-Customer-123!';
 const registered=await request('/api/customer-account',{action:'register',name:'Aysel Məmmədova',phone:'+994500000001',email,password});assert.equal(registered.status,200,JSON.stringify(registered.data));
 const issued=registered.response.headers.get('set-cookie');assert.match(issued,/HttpOnly/);assert.ok(!/; Secure/i.test(issued),'Loopback preview must retain customer cookies over HTTP');cookie=issued.split(';')[0];
 const account=await request('/api/customer-account');assert.equal(account.data.user.name,'Aysel Məmmədova');assert.equal((await request('/api/my-orders')).data.orders.length,0);
 const [product]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('CUSTOMER-QA','Manqal',40,20) returning id");
 const [option]=await sql.unsafe("insert into product_options(product_id,label,size,price) values($1,'60 sm · Qara','60 sm',60) returning id",[product.id]);
 const payload={requestKey:randomUUID(),expectedTotal:60,fulfillment:'pickup',address:'',name:'Aysel Məmmədova',phone:'+994500000001',note:'',items:[{id:product.id,optionId:option.id,quantity:1}]};
 const order=await request('/api/customer-orders',payload);assert.equal(order.status,201,JSON.stringify(order.data));
 assert.equal((await request('/api/customer-orders',payload)).data.order_no,order.data.order_no,'Retry must not duplicate the order');
 const orders=await request('/api/my-orders');assert.equal(orders.status,200);assert.equal(orders.data.orders.length,1);assert.equal(orders.data.orders[0].order_no,order.data.order_no);assert.match(orders.data.orders[0].items[0].name,/60 sm/);
 const ownerCookie=cookie;const other=await request('/api/customer-account',{action:'register',name:'Başqa müştəri',phone:'+994500000002',email:'other-'+randomUUID()+'@example.test',password});cookie=other.response.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/my-orders')).data.orders.length,0,'Customers only see their own orders');
 cookie=ownerCookie;await request('/api/customer-account',undefined,'DELETE');assert.equal((await request('/api/my-orders')).status,401,'Logout revokes the database session');
 const login=await request('/api/customer-account',{action:'login',email,password});assert.equal(login.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/my-orders')).data.orders.length,1);
 assert.equal((await request('/api/customer-account',{action:'login',email,password:'incorrect-password'})).status,401);
 console.log('PASS: customer registration/login, loopback cookies, order history, variant snapshots, retry idempotency, account isolation and logout. All data in isolated fixture database.');
 if(process.argv.includes('--serve')){console.log('UI fixture: '+origin+'/account | '+email+' | '+password);await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.resume();process.stdin.once('data',resolve);});process.stdin.pause();}
}finally{server.kill();await sql.end({timeout:2});await db.close();}
