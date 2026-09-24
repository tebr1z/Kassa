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
    const body = await request.json() as { action?: string; openingCash?: number | string; actualCash?: number | string };
    if (!['open', 'close'].includes(String(body.action))) {
      return NextResponse.json({ error: "Növbə əməliyyatı düzgün deyil" }, { status: 400 });
    }
    const result = await sql.begin(async (tx) => {
      const userId = request.headers.get("x-birkassa-user-id");
      const [cashier] = await tx.unsafe("select id, full_name, role, branch_id from users where id=$1 and is_active=true", [userId]);
      if (!cashier) throw Object.assign(new Error("İstifadəçi sessiyası tapılmadı"), { statusCode: 401 });
      const [warehouse] = await tx.unsafe(salesWarehouseSql(userId || ""));
      const branchId = warehouse?.branch_id || cashier.branch_id;
      if (!branchId) throw Object.assign(new Error("Kassirə mağaza təyin edin"), { statusCode: 409 });
      if (!cashier.branch_id) await tx.unsafe("update users set branch_id=$1 where id=$2", [branchId, cashier.id]);
      const [active] = await tx.unsafe(
        "select id, opening_cash, opened_at from cashier_shifts where cashier_id=$1 and closed_at is null order by opened_at desc limit 1 for update",
        [cashier.id],
      );

      if (body.action === 'open') {
        const openingCash = Number(body.openingCash);
        if (!Number.isFinite(openingCash) || openingCash < 0) throw Object.assign(new Error("Başlanğıc nağd məbləğini düzgün yazın"), { statusCode: 400 });
        if (active) return { status: 'open', shiftId: active.id, openedAt: active.opened_at, openingCash: Number(active.opening_cash) };
        const [shift] = await tx.unsafe(
          "insert into cashier_shifts (branch_id, cashier_id, opening_cash, expected_cash) values ($1,$2,$3,$3) returning id, opened_at",
          [branchId, cashier.id, openingCash],
        );
        await tx.unsafe(
          "insert into audit_logs (user_id, action, entity_type, entity_id, after_json) values ($1,'shift.opened','cashier_shift',$2,$3)",
          [cashier.id, shift.id, JSON.stringify({ openingCash })],
        );
        return { status: 'open', shiftId: shift.id, openedAt: shift.opened_at, openingCash };
      }

      if (!active) throw Object.assign(new Error("Bağlanacaq açıq növbə yoxdur"), { statusCode: 409 });
      const actualCash = Number(body.actualCash);
      if (!Number.isFinite(actualCash) || actualCash < 0) throw Object.assign(new Error("Faktiki nağd məbləğini düzgün yazın"), { statusCode: 400 });
      const [cash] = await tx.unsafe(
        "select coalesce(sum(p.amount),0) as total from payments p join sales s on s.id=p.sale_id where s.shift_id=$1 and s.status='completed' and p.method='cash'",
        [active.id],
      );
      const expectedCash = Number(active.opening_cash) + Number(cash.total);
      const difference = Number((actualCash - expectedCash).toFixed(2));
      const [closed] = await tx.unsafe(
        "update cashier_shifts set expected_cash=$1, actual_cash=$2, closed_at=now() where id=$3 returning closed_at",
        [expectedCash, actualCash, active.id],
      );
      await tx.unsafe(
        "insert into audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) values ($1,'shift.closed','cashier_shift',$2,$3,$4)",
        [cashier.id, active.id, JSON.stringify({ openingCash: Number(active.opening_cash) }), JSON.stringify({ expectedCash, actualCash, difference })],
      );
      return { status: 'closed', shiftId: active.id, closedAt: closed.closed_at, expectedCash, actualCash, difference };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("shift.action", error);void logSystemError("shift.action", error);
    return NextResponse.json({ error: error?.message || "Növbə əməliyyatı tamamlanmadı" }, { status: error?.statusCode || 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
