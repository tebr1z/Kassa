import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { salesWarehouseSql } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
}

export async function POST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as {
      productId?: string; quantity?: string | number; unitCost?: string | number;
      locationCode?: string; note?: string;
    };
    const quantity = Number(body.quantity);
    const unitCost = Number(body.unitCost);
    if (!body.productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      return NextResponse.json({ error: "Məhsul, say və alış qiymətini düzgün yazın" }, { status: 400 });
    }
    const productId = body.productId;

    const result = await sql.begin(async (tx) => {
      const [product] = await tx.unsafe("select id, name, cost_price from products where id=$1 and is_active=true", [productId]);
      if (!product) throw Object.assign(new Error("Məhsul tapılmadı"), { statusCode: 404 });
      const [warehouse] = await tx.unsafe(salesWarehouseSql(request.headers.get("x-birkassa-user-id") || ""));
      const userId = request.headers.get("x-birkassa-user-id");
      const [user] = await tx.unsafe("select id from users where id=$1 and is_active=true", [userId]);
      if (!warehouse || !user) throw Object.assign(new Error("Əsas anbar və ya istifadəçi tapılmadı"), { statusCode: user ? 404 : 401 });

      const locationCode = String(body.locationCode || "QƏBUL").trim().toUpperCase();
      let [location] = await tx.unsafe(
        "select id from warehouse_locations where warehouse_id=$1 and code=$2 limit 1",
        [warehouse.id, locationCode],
      );
      if (!location) [location] = await tx.unsafe(
        "insert into warehouse_locations (warehouse_id, code) values ($1,$2) returning id",
        [warehouse.id, locationCode],
      );

      const [movement] = await tx.unsafe(
        `insert into stock_movements
          (product_id, warehouse_id, location_id, type, quantity, unit_cost, reference_type, performed_by, note)
         values ($1,$2,$3,'receipt',$4,$5,'goods_receipt',$6,$7)
         returning id`,
        [product.id, warehouse.id, location.id, quantity, unitCost, user.id, body.note || "Mal qəbulu"],
      );
      await tx.unsafe("update products set cost_price=$1 where id=$2", [unitCost, product.id]);
      await tx.unsafe(
        `insert into audit_logs (user_id, action, entity_type, entity_id, after_json)
         values ($1,'stock.receipt','stock_movement',$2,$3)`,
        [user.id, movement.id, JSON.stringify({ productId: product.id, quantity, unitCost, locationCode })],
      );
      const [balance] = await tx.unsafe("select coalesce(sum(quantity),0) as stock from stock_movements where product_id=$1 and warehouse_id=$2", [product.id, warehouse.id]);
      return { movementId: movement.id, newStock: Number(balance.stock) };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("stock.receipt", error);void logSystemError("stock.receipt", error);
    return NextResponse.json({ error: error?.message || "Mal qəbulu saxlanmadı" }, { status: error?.statusCode || 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
