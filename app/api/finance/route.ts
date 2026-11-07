import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {createHash} from 'node:crypto';
import {z} from 'zod';
export const dynamic='force-dynamic';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const schema=z.object({action:z.enum(['transaction','payroll','supplier_payment']),type:z.enum(['income','expense']).default('expense'),category:z.string().trim().max(100).default('Digər'),description:z.string().trim().max(500).default(''),account:z.enum(['cash','bank']).default('cash'),amount:z.coerce.number().finite().positive().max(100000000),supplierId:z.string().uuid().optional(),employeeId:z.string().uuid().optional(),branchId:z.string().uuid().optional(),payee:z.string().trim().max(200).default(''),note:z.string().trim().max(1000).default(''),wagePeriod:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),occurredAt:date.optional(),requestKey:z.string().uuid().optional()});
async function get(request:Request){
 const url=new URL(request.url),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const from=url.searchParams.get('from')||today.slice(0,7)+'-01',to=url.searchParams.get('to')||today,branch=url.searchParams.get('branch')||null;
 if(!date.safeParse(from).success||!date.safeParse(to).success||from>to||(Date.parse(to)-Date.parse(from))/86400000>366||(branch&&!z.string().uuid().safeParse(branch).success))return Response.json({error:'Düzgün tarix aralığı seçin (ən çoxu 366 gün).'},{status:400});
 const sql=storeDb();try{
 const [totals]=await sql.unsafe("select coalesce(sum(s.total),0) revenue,coalesce(sum(costs.amount),0) cogs,count(*) receipts from sales s join cashier_shifts cs on cs.id=s.shift_id left join lateral(select coalesce(sum(si.cost_snapshot*si.quantity),0) amount from sale_items si where si.sale_id=s.id) costs on true where s.status='completed' and (s.created_at at time zone 'Asia/Baku')::date between $1::date and $2::date and ($3::uuid is null or cs.branch_id=$3)",[from,to,branch]);
 const [cash]=await sql.unsafe("select coalesce(sum(amount) filter(where type='expense'),0) expenses,coalesce(sum(amount) filter(where type='income'),0) other_income,coalesce(sum(amount) filter(where type='expense' and (employee_id is not null or category='Əməkhaqqı')),0) payroll from finance_transactions where (occurred_at at time zone 'Asia/Baku')::date between $1::date and $2::date and ($3::uuid is null or branch_id=$3)",[from,to,branch]);
 // PostgreSQL 13 needs explicit aliases for COST/NAMES in these positions.
 const sales=await sql.unsafe("select s.id,s.receipt_no,s.created_at,s.total,u.full_name cashier,b.name branch,coalesce(costs.amount,0) as \"cost\",coalesce(wh.names,'') warehouse,coalesce(lines.items,'[]'::json) items from sales s join users u on u.id=s.cashier_id join cashier_shifts cs on cs.id=s.shift_id join branches b on b.id=cs.branch_id left join lateral(select sum(cost_snapshot*quantity) amount from sale_items where sale_id=s.id) costs on true left join lateral(select string_agg(distinct w.name,', ') as \"names\" from stock_movements sm join warehouses w on w.id=sm.warehouse_id where sm.reference_id=s.id and sm.type='sale') wh on true left join lateral(select json_agg(json_build_object('name',coalesce(si.product_name_snapshot,p.name),'option',si.option_snapshot,'quantity',si.quantity,'salePrice',si.unit_price,'costPrice',si.cost_snapshot) order by si.id) items from sale_items si join products p on p.id=si.product_id where si.sale_id=s.id) lines on true where s.status='completed' and (s.created_at at time zone 'Asia/Baku')::date between $1::date and $2::date and ($3::uuid is null or cs.branch_id=$3) order by s.created_at desc limit 100",[from,to,branch]);
 const recent=await sql.unsafe("select f.id,f.type,f.category,f.description,f.account,f.amount,f.occurred_at,f.payee,f.note,f.wage_period,b.name branch,u.full_name employee from finance_transactions f left join branches b on b.id=f.branch_id left join users u on u.id=f.employee_id where (f.occurred_at at time zone 'Asia/Baku')::date between $1::date and $2::date and ($3::uuid is null or f.branch_id=$3) order by f.occurred_at desc,f.created_at desc limit 200",[from,to,branch]);
 const categories=await sql.unsafe("select category,sum(amount) amount from finance_transactions where type='expense' and (occurred_at at time zone 'Asia/Baku')::date between $1::date and $2::date and ($3::uuid is null or branch_id=$3) group by category order by amount desc",[from,to,branch]);
 const branches=await sql.unsafe('select id,name from branches where is_active=true order by name');
 const employees=await sql.unsafe('select u.id,u.full_name,u.salary,u.branch_id,b.name branch from users u left join branches b on b.id=u.branch_id where u.is_active=true order by u.full_name');
 const debts=await sql.unsafe("select su.id,su.name,coalesce((select sum(total) from purchase_orders where supplier_id=su.id and status='received'),0)-coalesce((select sum(amount) from supplier_payments where supplier_id=su.id),0) debt from suppliers su where su.is_active=true order by su.name");
 const revenue=Number(totals.revenue),cogs=Number(totals.cogs),expenses=Number(cash.expenses),otherIncome=Number(cash.other_income);
 return Response.json({range:{from,to,branch},metrics:{revenue,costOfGoods:cogs,grossProfit:revenue-cogs,expenses,otherIncome,payroll:Number(cash.payroll),netProfit:revenue-cogs+otherIncome-expenses,receipts:Number(totals.receipts)},sales:sales.map(row=>({...row,total:Number(row.total),cost:Number(row.cost),profit:Number(row.total)-Number(row.cost)})),recent:recent.map(row=>({...row,amount:Number(row.amount)})),categories:categories.map(row=>({...row,amount:Number(row.amount)})),branches,employees:employees.map(row=>({...row,salary:Number(row.salary||0)})),debts:debts.map(row=>({...row,debt:Number(row.debt)}))});
 }catch(error){console.error('finance.get',error);return Response.json({error:'Maliyyə məlumatları yüklənmədi.'},{status:503});}finally{await sql.end();}
}
async function post(request:Request){
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:'Məbləğ, tarix və əməliyyat məlumatlarını yoxlayın.'},{status:400});
 const body=parsed.data,sql=storeDb();try{
 const result=await sql.begin(async tx=>{
 const actor=request.headers.get('x-birkassa-user-id');
 if(body.action==='supplier_payment'){
  const fingerprint=createHash('sha256').update(JSON.stringify({...body,requestKey:undefined})).digest('hex');
  if(body.requestKey){await tx.unsafe('select pg_advisory_xact_lock(hashtext($1))',[body.requestKey]);const [prior]=await tx.unsafe('select id,request_fingerprint from supplier_payments where request_key=$1',[body.requestKey]);if(prior){if(prior.request_fingerprint!==fingerprint)throw Error('Bu açar başqa ödənişdə istifadə olunub.');return {ok:true,id:prior.id,replayed:true};}}

  if(!body.supplierId)throw Error('Təchizatçı seçin.');
  const [supplier]=await tx.unsafe("select id from suppliers where id=$1 for update",[body.supplierId]);if(!supplier)throw Error('Təchizatçı tapılmadı.');
  const [balance]=await tx.unsafe("select coalesce((select sum(total) from purchase_orders where supplier_id=$1 and status='received'),0)-coalesce((select sum(amount) from supplier_payments where supplier_id=$1),0) debt",[body.supplierId]);
  if(body.amount>Number(balance.debt))throw Error('Ödəniş borcdan çox ola bilməz.');
  const [row]=await tx.unsafe('insert into supplier_payments(supplier_id,amount,account,note,created_by,request_key,request_fingerprint) values($1,$2,$3,$4,$5,$6,$7) returning id',[body.supplierId,body.amount,body.account,body.note,actor,body.requestKey||null,fingerprint]);await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'finance.supplier_payment','supplier_payment',$2,$3)",[actor,row.id,JSON.stringify({supplierId:body.supplierId,amount:body.amount})]);return {ok:true,id:row.id};
 }
 const fingerprint=createHash('sha256').update(JSON.stringify({...body,requestKey:undefined})).digest('hex');
 if(body.requestKey){
  await tx.unsafe('select pg_advisory_xact_lock(hashtext($1))',[body.requestKey]);
  const [prior]=await tx.unsafe('select id,request_fingerprint from finance_transactions where request_key=$1',[body.requestKey]);
  if(prior){if(prior.request_fingerprint!==fingerprint)throw Error('Bu sorğu açarı başqa əməliyyatda istifadə olunub.');return {ok:true,id:prior.id,replayed:true};}
 }
 let branchId=body.branchId||null,employeeId:string|null=null,payee=body.payee,description=body.description,category=body.category,type=body.type;
 if(body.action==='payroll'){
  if(!body.employeeId||!body.wagePeriod)throw Error('İşçi və maaş ayını seçin.');
  const [employee]=await tx.unsafe('select id,full_name,branch_id from users where id=$1 and is_active=true for update',[body.employeeId]);if(!employee)throw Error('İşçi tapılmadı.');
  employeeId=employee.id;branchId=employee.branch_id;payee=employee.full_name;category='Əməkhaqqı';type='expense';description='Əməkhaqqı — '+employee.full_name+' ('+body.wagePeriod+')';
 }else if(description.length<2||category.length<2)throw Error('Xərcin kateqoriyasını və nə üçün ödəniş edildiyini yazın.');
 if(branchId){const [branch]=await tx.unsafe('select id from branches where id=$1 and is_active=true',[branchId]);if(!branch)throw Error('Mağaza tapılmadı.');}
 const [row]=await tx.unsafe("insert into finance_transactions(type,category,description,account,amount,created_by,occurred_at,branch_id,employee_id,payee,note,wage_period,request_key,request_fingerprint) values($1,$2,$3,$4,$5,$6,coalesce(($7::date+time '12:00') at time zone 'Asia/Baku',now()),$8,$9,$10,$11,$12,$13,$14) returning id",[type,category,description,body.account,body.amount,actor,body.occurredAt||null,branchId,employeeId,payee||null,body.note||null,body.wagePeriod||null,body.requestKey||null,fingerprint]);
 await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,$2,'finance_transaction',$3,$4)",[actor,body.action==='payroll'?'finance.payroll_paid':'finance.transaction_created',row.id,JSON.stringify({type,category,description,amount:body.amount,branchId,employeeId})]);return {ok:true,id:row.id};
 });return Response.json(result,{status:201});
 }catch(error){return Response.json({error:error instanceof Error&&!('code'in error)?error.message:'Ödəniş saxlanmadı.'},{status:409});}finally{await sql.end();}
}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
