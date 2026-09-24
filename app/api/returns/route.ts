import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { findManagerByPin } from "@/lib/pin";
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
    const body = await request.json() as { saleId?: string; reason?: string; managerPin?: string };
    const reason = String(body.reason || "").trim();
    if (!body.saleId || reason.length < 3) {
      return NextResponse.json({ error: "Çeki və qaytarma səbəbini yazın" }, { status: 400 });
    }
    const saleId = body.saleId;
    const result = await sql.begin(async (tx) => {
      const [sale] = await tx.unsafe(
        "select id, receipt_no, status, cashier_id, total from sales where id=$1 for update",
        [saleId],
      );
      if (!sale) throw Object.assign(new Error("Çek tapılmadı"), { statusCode: 404 });
      if (sale.status !== 'completed') throw Object.assign(new Error("Bu çek artıq qaytarılıb və ya ləğv edilib"), { statusCode: 409 });
      const [rule] = await tx.unsafe("select value from system_settings where key='require_manager_return'");
      const actorId = request.headers.get("x-birkassa-user-id") || sale.cashier_id;
      let approvedBy = actorId;
      if (rule?.value !== "false") {
        const manager = await findManagerByPin(tx, String(body.managerPin || ""));
        if (!manager) throw Object.assign(new Error("Qaytarma üçün rəhbər PIN-i düzgün deyil"), { statusCode: 403 });
        approvedBy = manager.id;
      }
      const [warehouse] = await tx.unsafe(salesWarehouseSql(request.headers.get("x-birkassa-user-id") || ""));
      if (!warehouse) throw new Error("Əsas anbar tapılmadı");
      const items = await tx.unsafe(
        `select si.product_id, si.quantity, si.cost_snapshot,
          (select sm.location_id from stock_movements sm
           where sm.reference_id=s.id and sm.product_id=si.product_id and sm.type='sale'
           order by sm.created_at desc limit 1) as location_id
         from sale_items si join sales s on s.id=si.sale_id where si.sale_id=$1`,
        [sale.id],
      );
      if (!items.length) throw new Error("Çekin məhsulları tapılmadı");
      for (const item of items) {
        await tx.unsafe(
          `insert into stock_movements
            (product_id, warehouse_id, location_id, type, quantity, unit_cost, reference_type, reference_id, performed_by, note)
           values ($1,$2,$3,'return',$4,$5,'sale_return',$6,$7,$8)`,
          [item.product_id, warehouse.id, item.location_id, Number(item.quantity), item.cost_snapshot, sale.id, sale.cashier_id, `${sale.receipt_no}: ${reason}`],
        );
      }
      await tx.unsafe("update sales set status='returned' where id=$1", [sale.id]);
      await tx.unsafe(
        "insert into audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) values ($1,'sale.returned','sale',$2,$3,$4)",
        [approvedBy, sale.id, JSON.stringify({ status: 'completed' }), JSON.stringify({ status: 'returned', reason, total: Number(sale.total), cashierId: sale.cashier_id })],
      );
      return { saleId: sale.id, receiptNo: sale.receipt_no, status: 'returned', restoredItems: items.length };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("sale.return", error);void logSystemError("sale.return", error);
    return NextResponse.json({ error: error?.message || "Qaytarma tamamlanmadı" }, { status: error?.statusCode || 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
