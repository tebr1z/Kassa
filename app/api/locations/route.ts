import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {staffRoles} from '@/lib/staff-access';
import {strongPassword,staffPasswordHash} from '@/lib/staff-password';
import {z} from 'zod';
export const dynamic='force-dynamic';
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('branch'),name:z.string().trim().min(2).max(150),address:z.string().trim().max(500).default('')}),
 z.object({action:z.literal('warehouse'),branchId:z.string().uuid(),name:z.string().trim().min(2).max(150),code:z.string().trim().min(2).max(40)}),
 z.object({action:z.literal('assign'),userId:z.string().uuid(),branchId:z.string().uuid(),warehouseId:z.string().uuid()}),
 z.object({action:z.literal('cashier'),fullName:z.string().trim().min(2).max(150),branchId:z.string().uuid(),warehouseId:z.string().uuid(),password:z.string().refine(strongPassword),salary:z.number().finite().min(0).max(1000000).default(0)}),
 z.object({action:z.literal('password'),userId:z.string().uuid(),password:z.string().refine(strongPassword)})
]);
async function get(){const sql=storeDb();try{
 const branches=await sql.unsafe('select id,name,address from branches where is_active=true order by name');
 const warehouses=await sql.unsafe('select w.id,w.branch_id,w.name,w.code,b.name branch_name from warehouses w join branches b on b.id=w.branch_id where b.is_active=true order by b.name,w.name');
 const users=await sql.unsafe("select u.id,u.full_name,u.role,u.branch_id,u.sales_warehouse_id,u.is_active,u.password_hash is not null has_password,b.name branch_name,w.name warehouse_name from users u left join branches b on b.id=u.branch_id left join warehouses w on w.id=u.sales_warehouse_id order by u.full_name");
 return Response.json({branches,warehouses,users});
 }finally{await sql.end();}}
async function post(request:Request){const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:'Məlumatları yoxlayın. Şifrə ən azı 12 simvol, hərf və rəqəm olmalıdır.'},{status:400});const b=parsed.data,sql=storeDb();try{
 const result=await sql.begin(async tx=>{
  const actor=request.headers.get('x-birkassa-user-id');let id='';
  if(b.action==='branch'){const [row]=await tx.unsafe('insert into branches(name,address) values($1,$2) returning id',[b.name,b.address||null]);id=row.id;}
  else if(b.action==='warehouse'){
   const [branch]=await tx.unsafe('select id from branches where id=$1 and is_active=true',[b.branchId]);if(!branch)throw Error('Mağaza tapılmadı.');
   const [row]=await tx.unsafe('insert into warehouses(branch_id,name,code) values($1,$2,$3) returning id',[b.branchId,b.name,b.code.toUpperCase()]);id=row.id;
  }else if(b.action==='assign'||b.action==='cashier'){
   const [location]=await tx.unsafe('select w.id from warehouses w join branches b on b.id=w.branch_id where w.id=$1 and b.id=$2 and b.is_active=true',[b.warehouseId,b.branchId]);if(!location)throw Error('Anbar seçilmiş mağazaya aid deyil.');
   if(b.action==='cashier'){const [row]=await tx.unsafe("insert into users(full_name,role,branch_id,sales_warehouse_id,password_hash,salary) values($1,'cashier',$2,$3,$4,$5) returning id",[b.fullName,b.branchId,b.warehouseId,await staffPasswordHash(b.password),b.salary]);id=row.id;}
   else{
    const [user]=await tx.unsafe('select id,branch_id,sales_warehouse_id from users where id=$1 and is_active=true for update',[b.userId]);if(!user)throw Error('İşçi tapılmadı.');
    const [shift]=await tx.unsafe('select id from cashier_shifts where cashier_id=$1 and closed_at is null',[b.userId]);if(shift&&(user.branch_id!==b.branchId||user.sales_warehouse_id!==b.warehouseId))throw Error('Əvvəl işçinin açıq kassa növbəsini bağlayın.');
    await tx.unsafe('update users set branch_id=$1,sales_warehouse_id=$2 where id=$3',[b.branchId,b.warehouseId,b.userId]);id=b.userId;
    await tx.unsafe('delete from auth_sessions where user_id=$1 and user_id<>$2',[id,actor]);
   }
  }else{
   const [user]=await tx.unsafe("select id,role from users where id=$1 and is_active=true for update",[b.userId]);if(!user||!staffRoles.includes(user.role))throw Error('Aktiv işçi tapılmadı.');
   await tx.unsafe('update users set password_hash=$1 where id=$2',[await staffPasswordHash(b.password),b.userId]);await tx.unsafe('delete from auth_sessions where user_id=$1',[b.userId]);id=b.userId;
  }
  const safe={...b} as Record<string,unknown>;delete safe.password;
  await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,$2,'locations',$3,$4)",[actor,'locations.'+b.action,id,JSON.stringify(safe)]);return {ok:true,id};
 });return Response.json(result);
 }catch(error){return Response.json({error:error instanceof Error&&!('code'in error)?error.message:'Ad və ya kod təkrarlanır; məlumatları yoxlayın.'},{status:409});}finally{await sql.end();}}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
