import "dotenv/config";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import ts from "typescript";
const require=createRequire(import.meta.url);
async function moduleFrom(file){
 let source=await readFile(new URL(file,import.meta.url),"utf8");
 source=source.replace('from "zod"',()=> "from "+JSON.stringify(pathToFileURL(require.resolve("zod")).href));
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
}
const {saveCheckoutAttempt,readCheckoutAttempt,clearCheckoutAttempt,isDefinitiveCheckoutRejection}=await moduleFrom("../lib/checkout-attempt.ts");
const saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
const attempt={version:1,accountId:randomUUID(),createdAt:new Date().toISOString(),itemNames:{},payload:{requestKey:randomUUID(),coupon:"",expectedTotal:10,fulfillment:"pickup",address:"",name:"QA Customer",phone:"+994000000000",note:"",items:[{id:randomUUID(),quantity:2}]}};
assert.equal(saveCheckoutAttempt(attempt,storage),true);
assert.deepEqual(readCheckoutAttempt(attempt.accountId,storage).attempt,attempt,"retry must preserve full payload and key");
assert.equal(readCheckoutAttempt(randomUUID(),storage).status,"empty","attempt must be scoped to account");
assert.equal(clearCheckoutAttempt(attempt.accountId,randomUUID(),storage),false);
assert.equal(isDefinitiveCheckoutRejection(503),false,"unknown commit outcome must preserve attempt");
assert.equal(isDefinitiveCheckoutRejection(400),true);
assert.equal(clearCheckoutAttempt(attempt.accountId,attempt.payload.requestKey,storage),true);
assert.equal(saveCheckoutAttempt(attempt,{...storage,setItem(){throw Error("blocked")}}),false);
console.log("Checkout retry persistence: passed.");

const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
try{
 const {recentReceiptsSql}=await moduleFrom("../lib/receipt-query.ts");
 const rollback=new Error("QA rollback");
 try{await sql.begin(async tx=>{
  const [shift]=await tx.unsafe("select id,cashier_id from cashier_shifts limit 1");
  assert.ok(shift,"a shift is needed for the rollback-only receipt test");
  const products=await tx.unsafe("select id from products order by id limit 2");
  assert.equal(products.length,2);
  const [sale]=await tx.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,discount,total,receipt_store,created_at) values($1,$2,$3,30,5,25,$4::text::jsonb,now()+interval '1 second') returning id",["QA-"+randomUUID(),shift.id,shift.cashier_id,JSON.stringify({name:"QA Market",phone:"QA phone",address:"QA address",cashier:"QA cashier"})]);
  for(const [i,p] of products.entries())await tx.unsafe("insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total,product_name_snapshot) values($1,$2,1,$3,0,$3,$4)",[sale.id,p.id,(i+1)*10,"Snapshot "+i]);
  await tx.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',10),($1,'card',15)",[sale.id]);
  const rows=await tx.unsafe(recentReceiptsSql),row=rows.find(r=>r.id===sale.id);
  assert.ok(row);
  assert.equal(row.items.length,2,"mixed payment must not duplicate item rows");
  assert.equal(row.items.reduce((n,i)=>n+Number(i.lineTotal),0),30);
  assert.equal(row.payment_details.reduce((n,p)=>n+Number(p.amount),0),25);
  assert.equal(Number(row.discount),5);
  assert.equal(row.receipt_store.name,"QA Market");
  assert.equal(row.full_name,"QA cashier");
  assert.ok(row.items.every(i=>i.name.startsWith("Snapshot ")));
  throw rollback;
 });}catch(e){if(e!==rollback)throw e;}
 console.log("Receipt mixed payments and historical snapshots: passed; all fixture writes rolled back.");
 const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:3000";
 const response=await fetch(origin+"/api/catalog");
 assert.equal(response.status,200);
 assert.match(response.headers.get("cache-control"),/no-store/);
 const data=await response.json();
 const fields=["id","name","category","unit","price","originalPrice","image","available","description","specifications"].sort();
 for(const p of data.products)assert.deepEqual(Object.keys(p).sort(),fields,"public product field allowlist");
 const available=await sql.unsafe("select p.id from products p where p.is_active=true and coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0");
 assert.deepEqual(data.products.map(p=>p.id).sort(),available.map(p=>p.id).sort(),"inactive and empty-stock products hidden");
 assert.ok(data.slides.every(s=>!s.productId||data.products.some(p=>p.id===s.productId)));
 for(const path of ["/api/products","/api/dashboard","/api/store-admin","/api/store-admin/slides","/api/system?view=dump","/api/my-orders"]){
  assert.equal((await fetch(origin+path,{headers:{"x-birkassa-role":"admin","x-birkassa-user-id":randomUUID()}})).status,401,path+" requires authentication");
 }
 assert.equal((await fetch(origin+"/api/auth-fake")).status,403);
 assert.equal((await fetch(origin+"/api/contact",{method:"POST",headers:{"Origin":"https://untrusted.example","Content-Type":"application/json"},body:"{}"})).status,403);
 console.log("Public stock privacy, protected APIs, forged role headers, exact auth path and cross-site rejection: passed.");
}finally{await sql.end({timeout:3});}
