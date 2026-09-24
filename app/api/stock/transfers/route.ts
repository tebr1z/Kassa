import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { logSystemError } from "@/lib/log-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL yoxdur" }, { status: 500 });
  const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
  try{
    const body=await request.json() as {productId?:string;sourceWarehouseId?:string;destinationWarehouseId?:string;quantity?:string|number;destinationLocation?:string;note?:string};
    const quantity=Math.abs(Number(body.quantity));
    if(!body.productId||!body.sourceWarehouseId||!body.destinationWarehouseId||body.sourceWarehouseId===body.destinationWarehouseId||!Number.isFinite(quantity)||quantity<=0) return NextResponse.json({error:"Transfer məlumatları düzgün deyil"},{status:400});
    const {productId,sourceWarehouseId,destinationWarehouseId}=body;
    const result=await sql.begin(async tx=>{
      const [user]=await tx.unsafe("select id from users where id=$1 and is_active=true",[request.headers.get("x-birkassa-user-id")]);
      if(!user) throw Object.assign(new Error("İstifadəçi sessiyası tapılmadı"),{statusCode:401});
      const [balance]=await tx.unsafe("select coalesce(sum(quantity),0) as stock from stock_movements where product_id=$1 and warehouse_id=$2",[productId,sourceWarehouseId]);
      if(Number(balance.stock)<quantity) throw Object.assign(new Error(`Mənbə anbarda yalnız ${Number(balance.stock)} ədəd var`),{statusCode:409});
      const [sourceLocation]=await tx.unsafe("select location_id from stock_movements where product_id=$1 and warehouse_id=$2 and location_id is not null order by created_at desc limit 1",[productId,sourceWarehouseId]);
      const code=String(body.destinationLocation||"QƏBUL").trim().toUpperCase();
      let [destinationLocation]=await tx.unsafe("select id from warehouse_locations where warehouse_id=$1 and code=$2 limit 1",[destinationWarehouseId,code]);
      if(!destinationLocation)[destinationLocation]=await tx.unsafe("insert into warehouse_locations (warehouse_id,code) values ($1,$2) returning id",[destinationWarehouseId,code]);
      const referenceId=randomUUID();
      const [outMovement]=await tx.unsafe(`insert into stock_movements (product_id,warehouse_id,location_id,type,quantity,reference_type,reference_id,performed_by,note) values ($1,$2,$3,'transfer_out',$4,'warehouse_transfer',$5,$6,$7) returning id`,[productId,sourceWarehouseId,sourceLocation?.location_id||null,-quantity,referenceId,user.id,body.note||"Anbar transferi"]);
      await tx.unsafe(`insert into stock_movements (product_id,warehouse_id,location_id,type,quantity,reference_type,reference_id,performed_by,note) values ($1,$2,$3,'transfer_in',$4,'warehouse_transfer',$5,$6,$7)`,[productId,destinationWarehouseId,destinationLocation.id,quantity,referenceId,user.id,body.note||"Anbar transferi"]);
      await tx.unsafe(`insert into audit_logs (user_id,action,entity_type,entity_id,after_json) values ($1,'stock.transfer','stock_movement',$2,$3)`,[user.id,outMovement.id,JSON.stringify({productId,sourceWarehouseId,destinationWarehouseId,quantity,referenceId})]);
      return {referenceId};
    });
    return NextResponse.json(result,{status:201});
  }catch(error:any){console.error("stock.transfer",error);void logSystemError("stock.transfer",error);return NextResponse.json({error:error?.message||"Transfer saxlanmadı"},{status:error?.statusCode||500})}finally{await sql.end({timeout:2})}
}
