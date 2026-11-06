import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,createHash,randomUUID,scryptSync} from 'node:crypto';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const database=await openLocalDatabase(path.resolve('.local-desktop-data','pos-'+randomUUID()),process.cwd(),{port:55442});
const sql=postgres(database.url,{max:1,prepare:false,connect_timeout:5});
const port=5761,origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,env:{...process.env,DATABASE_URL:database.url,BIRKASSA_LOCAL:'1',NODE_ENV:'production'},stdio:'ignore'});
try{
 let ready=false;for(let n=0;n<60;n++){try{if((await fetch(origin+'/api/auth')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'Local server must start');
 const [admin]=await sql.unsafe("select * from users where role='admin' limit 1");
 const salt=randomBytes(16).toString('hex');await sql.unsafe('update users set password_hash=$1 where id=$2',[salt+':'+scryptSync('Fixture-Password-04!',salt,64).toString('hex'),admin.id]);
 const token=randomBytes(32).toString('hex');await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[admin.id,createHash('sha256').update(token).digest('hex')]);
 const request=async(url,body)=>{const result=await fetch(origin+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,Cookie:'birkassa_session='+token},body:body?JSON.stringify(body):undefined});return {status:result.status,data:await result.json()};};
 const sku='LOCAL-QA-'+randomUUID().slice(0,8),product=await request('/api/store-admin/commerce',{action:'product',name:'Mangal — ölçü seçimi',sku,category:'Manqallar',unit:'ədəd',sale_price:40,cost_price:20,description:'Lokal yoxlama məhsulu',specifications:'Material: Dəmir',discount_price:35,is_active:true,barcode:''});assert.equal(product.status,200,JSON.stringify(product.data));
 const [p]=await sql.unsafe('select id from products where sku=$1',[sku]);
 for(const [label,price] of [['40 sm',40],['60 sm',60]])assert.equal((await request('/api/store-admin/commerce',{action:'option',product_id:p.id,label,size:label,color:'Qara',kind:'Dəmir',price,is_active:true,position:0})).status,200);
 const options=await sql.unsafe('select id from product_options where product_id=$1 order by price',[p.id]);const [warehouse]=await sql.unsafe('select id from warehouses limit 1');
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,performed_by) values($1,$2,'receipt',5,$3)",[p.id,warehouse.id,admin.id]);
 await sql.unsafe("insert into product_categories(name,show_on_home) values('Manqallar',true) on conflict(name) do update set show_on_home=true");
 if(!(await sql.unsafe('select id from cashier_shifts where cashier_id=$1 and closed_at is null',[admin.id])).length)await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0)',[admin.branch_id,admin.id]);
 const catalog=await request('/api/catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.products.find(item=>item.id===p.id).options.length,2);
 const missing=await request('/api/sales',{paymentMethod:'cash',items:[{productId:p.id,quantity:1}]});assert.equal(missing.status,400,'Variant selection is required');
 const oversell=await request('/api/sales',{paymentMethod:'cash',items:options.map(option=>({productId:p.id,optionId:option.id,quantity:3}))});assert.equal(oversell.status,409,'Variants must share aggregate stock limit');
 const sale=await request('/api/sales',{paymentMethod:'cash',buyerName:'Test alıcı',items:[{productId:p.id,optionId:options[1].id,quantity:1}]});assert.equal(sale.status,201,JSON.stringify(sale.data));assert.equal(sale.data.total,60);assert.equal(sale.data.receipt.buyerName,'Test alıcı');assert.equal(sale.data.receipt.items[0].optionLabel,'60 sm');assert.ok(sale.data.receipt.createdAt);assert.ok(sale.data.receiptNo);
 const dashboard=await request('/api/dashboard');assert.equal(dashboard.status,200);assert.equal(dashboard.data.recent.find(row=>row.id===sale.data.saleId).buyerName,'Test alıcı');
 const blank=await request('/api/sales',{paymentMethod:'card',items:[{productId:p.id,optionId:options[0].id,quantity:1}]});assert.equal(blank.status,201);assert.equal(blank.data.receipt.buyerName,'');
 await database.backup(path.join(database.dataRoot,'verified.dump'));console.log('PASS: local migrations, catalogue options, required selection, aggregate stock, variant pricing, buyer/blank buyer, invoice snapshot, backup.');
 if(process.argv.includes('--serve')){console.log('UI verification: '+origin);await new Promise(()=>{});}
}finally{server.kill();await sql.end({timeout:2});await database.close();}
