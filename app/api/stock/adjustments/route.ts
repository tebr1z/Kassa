import { NextResponse } from "next/server";
import postgres from "postgres";
import { logSystemError } from "@/lib/log-error";
import { salesWarehouseSql } from "@/lib/warehouse";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL yoxdur" }, { status: 500 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const body = await request.json() as { productId?:string; quantity?:string|number; direction?:"increase"|"decrease"; reason?:string };
    const quantity=Math.abs(Number(body.quantity));
    if(!body.productId||!Number.isFinite(quantity)||quantity<=0||!body.direction||!body.reason) return NextResponse.json({error:"Bütün məlumatları düzgün yazın"},{status:400});
    const productId=body.productId; const direction=body.direction; const reason=body.reason;
    const result=await sql.begin(async tx=>{
      const [warehouse]=await tx.unsafe(salesWarehouseSql(request.headers.get("x-birkassa-user-id")||""));
      const [user]=await tx.unsafe("select id from users where id=$1 and is_active=true",[request.headers.get("x-birkassa-user-id")]);
      const [product]=await tx.unsafe("select id from products where id=$1 and is_active=true",[productId]);
      if(!user) throw Object.assign(new Error("İstifadəçi sessiyası tapılmadı"),{statusCode:401});
      if(!warehouse||!product) throw Object.assign(new Error("Məhsul və ya əsas anbar tapılmadı"),{statusCode:404});
      const [balance]=await tx.unsafe("select coalesce(sum(quantity),0) as stock from stock_movements where product_id=$1 and warehouse_id=$2",[product.id,warehouse.id]);
      const current=Number(balance.stock); const signed=direction==="decrease"?-quantity:quantity;
      if(current+signed<0) throw Object.assign(new Error(`Qalıq kifayət deyil. Cari qalıq: ${current}`),{statusCode:409});
      const [location]=await tx.unsafe("select id from warehouse_locations where warehouse_id=$1 order by id limit 1",[warehouse.id]);
      const [movement]=await tx.unsafe(`insert into stock_movements (product_id,warehouse_id,location_id,type,quantity,reference_type,performed_by,note) values ($1,$2,$3,$4,$5,'stock_adjustment',$6,$7) returning id`,[product.id,warehouse.id,location?.id||null,direction==="decrease"?"write_off":"adjustment",signed,user.id,reason]);
      await tx.unsafe(`insert into audit_logs (user_id,action,entity_type,entity_id,after_json) values ($1,'stock.adjustment','stock_movement',$2,$3)`,[user.id,movement.id,JSON.stringify({productId,direction,quantity,reason})]);
      return {newStock:current+signed};
    });
    return NextResponse.json(result,{status:201});
  }catch(error:any){console.error("stock.adjustment",error);void logSystemError("stock.adjustment",error);return NextResponse.json({error:error?.message||"Stok düzəlişi saxlanmadı"},{status:error?.statusCode||500})}finally{await sql.end({timeout:2})}
}
