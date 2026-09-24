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

export async function GET(request: Request) {
  const sql = connection();
  try {
    const [today] = await sql.unsafe(`
      select coalesce(sum(s.total),0) as total, count(*) as count,
        coalesce(sum(s.total - costs.cost_total),0) as profit
      from sales s
      left join lateral (
        select coalesce(sum(si.cost_snapshot * si.quantity),0) as cost_total
        from sale_items si where si.sale_id=s.id
      ) costs on true
      where s.status='completed'
        and (s.created_at at time zone 'Asia/Baku')::date=(now() at time zone 'Asia/Baku')::date
    `);
    const payments = await sql.unsafe(`
      select p.method, coalesce(sum(p.amount),0) as total
      from payments p join sales s on s.id=p.sale_id
      where s.status='completed'
        and (s.created_at at time zone 'Asia/Baku')::date=(now() at time zone 'Asia/Baku')::date
      group by p.method
    `);
    const weekly = await sql.unsafe(`
      with days as (
        select generate_series(
          (now() at time zone 'Asia/Baku')::date - interval '6 days',
          (now() at time zone 'Asia/Baku')::date,
          interval '1 day'
        )::date as day
      )
      select d.day, coalesce(sum(s.total),0) as total
      from days d left join sales s
        on (s.created_at at time zone 'Asia/Baku')::date=d.day and s.status='completed'
      group by d.day order by d.day
    `);
    const recent = await sql.unsafe(`
      select s.id, s.receipt_no, s.total, s.status, s.created_at, u.full_name,
        coalesce(string_agg(distinct p.method, ', '),'') as payment_method,
        coalesce(json_agg(json_build_object(
          'name', pr.name, 'quantity', si.quantity, 'unitPrice', si.unit_price, 'lineTotal', si.line_total
        ) order by si.id) filter (where si.id is not null), '[]'::json) as items
      from sales s
      join users u on u.id=s.cashier_id
      left join payments p on p.sale_id=s.id
      left join sale_items si on si.sale_id=s.id
      left join products pr on pr.id=si.product_id
      where s.status in ('completed','returned')
      group by s.id, u.full_name
      order by s.created_at desc limit 8
    `);
    const [shift] = await sql.unsafe(`
      select cs.id, cs.opening_cash, cs.opened_at,
        coalesce(sum(p.amount) filter (where p.method='cash'),0) as cash_sales,
        coalesce(sum(p.amount) filter (where p.method='card'),0) as card_sales
      from cashier_shifts cs
      left join sales s on s.shift_id=cs.id and s.status='completed'
      left join payments p on p.sale_id=s.id
      where cs.closed_at is null and cs.cashier_id=$1
      group by cs.id order by cs.opened_at desc limit 1
    `, [request.headers.get("x-birkassa-user-id")]);

    const paymentMap = Object.fromEntries(payments.map((row) => [row.method, Number(row.total)]));
    return NextResponse.json({
      today: { total: Number(today.total), count: Number(today.count), profit: Number(today.profit) },
      payments: { cash: paymentMap.cash || 0, card: paymentMap.card || 0 },
      weekly: weekly.map((row) => ({ day: row.day, total: Number(row.total) })),
      recent: recent.map((row) => ({
        id: row.id, receiptNo: row.receipt_no, total: Number(row.total), status: row.status, createdAt: row.created_at,
        cashier: row.full_name, paymentMethod: row.payment_method,
        items: row.items.map((item: any) => ({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), lineTotal: Number(item.lineTotal) })),
      })),
      shift: shift ? {
        id: shift.id, openedAt: shift.opened_at, openingCash: Number(shift.opening_cash), cashSales: Number(shift.cash_sales),
        cardSales: Number(shift.card_sales), expectedCash: Number(shift.opening_cash) + Number(shift.cash_sales),
      } : null,
      registerName: (await sql.unsafe("select r.name from cash_registers r join users u on u.branch_id=r.branch_id where r.is_active=true and u.id=$1 order by r.created_at limit 1", [request.headers.get("x-birkassa-user-id")]))[0]?.name || "Kassa",
      branchName: (await sql.unsafe("select b.name from branches b join users u on u.branch_id=b.id where u.id=$1", [request.headers.get("x-birkassa-user-id")]))[0]?.name || "Mağaza",
      branchAddress: (await sql.unsafe("select b.address from branches b join users u on u.branch_id=b.id where u.id=$1", [request.headers.get("x-birkassa-user-id")]))[0]?.address || "",
      alerts: (await sql.unsafe("select value from system_settings where key='low_stock_alert'"))[0]?.value==="false"?[]:(await sql.unsafe(`select p.name, coalesce(max(wl.code),'Mövqe yoxdur') location, p.min_stock, coalesce(sum(sm.quantity),0) stock from products p left join stock_movements sm on sm.product_id=p.id and sm.warehouse_id=(select id from (${salesWarehouseSql(request.headers.get("x-birkassa-user-id") || "")}) sales_warehouse) left join warehouse_locations wl on wl.id=sm.location_id where p.is_active=true group by p.id having coalesce(sum(sm.quantity),0) <= p.min_stock order by coalesce(sum(sm.quantity),0) limit 6`)).map((row: any)=>({name:row.name,location:row.location,min:Number(row.min_stock),stock:Number(row.stock)})),
      suspicious: (await sql.unsafe(`select s.receipt_no, s.discount, s.subtotal, s.total, s.created_at, u.full_name, 'discount' kind from sales s join users u on u.id=s.cashier_id where s.status='completed' and s.subtotal>0 and s.discount/s.subtotal>=0.2 and s.created_at>now()-interval '7 days' union all select s.receipt_no, s.discount, s.subtotal, s.total, s.created_at, u.full_name, 'return' kind from sales s join users u on u.id=s.cashier_id where s.status='returned' and s.created_at>now()-interval '7 days' order by created_at desc limit 6`)).map((row: any)=>({receiptNo:row.receipt_no,kind:row.kind,cashier:row.full_name,total:Number(row.total),createdAt:row.created_at})),
    });
  } catch (error) {
    console.error("dashboard.get", error);void logSystemError("dashboard.get", error);
    return NextResponse.json({ error: "Satış göstəriciləri yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
