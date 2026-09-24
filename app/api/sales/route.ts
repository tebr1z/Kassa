import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { findManagerByPin } from "@/lib/pin";
import { salesWarehouseSql } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaleItemInput = { productId?: string; quantity?: number | string };

function connection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
}

export async function POST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as { items?: SaleItemInput[]; paymentMethod?: string; cashAmount?:number|string; cardAmount?:number|string; discount?:number|string; customerId?:string; salesOrderId?:string; managerPin?:string };
    const paymentMethod = String(body.paymentMethod || "").toLowerCase();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Çek boşdur" }, { status: 400 });
    }
    if (!['cash', 'card', 'mixed'].includes(paymentMethod)) {
      return NextResponse.json({ error: "Ödəniş növünü seçin" }, { status: 400 });
    }

    const merged = new Map<string, number>();
    for (const item of body.items) {
      const productId = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
        return NextResponse.json({ error: "Məhsul miqdarı düzgün deyil" }, { status: 400 });
      }
      merged.set(productId, (merged.get(productId) || 0) + quantity);
    }

    const result = await sql.begin(async (tx) => {
      const [warehouse] = await tx.unsafe(salesWarehouseSql(request.headers.get("x-birkassa-user-id") || ""));
      const userId=request.headers.get("x-birkassa-user-id");
      const [cashier] = await tx.unsafe("select id from users where id=$1 and is_active=true",[userId]);
      if (!cashier) throw Object.assign(new Error("İstifadəçi sessiyası tapılmadı"), { statusCode: 401 });
      if (!warehouse) throw Object.assign(new Error("Kassirə mağaza və satış anbarı təyin edin"), { statusCode: 409 });

      const [shift] = await tx.unsafe(
        "select id from cashier_shifts where cashier_id=$1 and closed_at is null order by opened_at desc limit 1",
        [cashier.id],
      );
      if (!shift) throw Object.assign(new Error("Satış üçün əvvəlcə kassa növbəsini açın"), { statusCode: 409 });

      const lines: Array<{ id:string; name:string; quantity:number; price:number; cost:number; total:number; locationId:string|null }> = [];
      for (const [productId, quantity] of merged) {
        const [product] = await tx.unsafe(
          "select id, name, sale_price, cost_price from products where id=$1 and is_active=true for update",
          [productId],
        );
        if (!product) throw Object.assign(new Error("Məhsul tapılmadı"), { statusCode: 404 });
        const [balance] = await tx.unsafe(
          "select coalesce(sum(quantity),0) as stock from stock_movements where product_id=$1 and warehouse_id=$2",
          [product.id, warehouse.id],
        );
        const stock = Number(balance.stock);
        if (stock < quantity) {
          throw Object.assign(new Error(`${product.name}: stokda yalnız ${stock} ədəd var`), { statusCode: 409 });
        }
        const [location] = await tx.unsafe(
          "select location_id from stock_movements where product_id=$1 and warehouse_id=$2 and location_id is not null order by created_at desc limit 1",
          [product.id, warehouse.id],
        );
        const price = Number(product.sale_price);
        lines.push({ id: product.id, name: product.name, quantity, price, cost: Number(product.cost_price), total: price * quantity, locationId: location?.location_id || null });
      }

      const subtotal = Number(lines.reduce((sum, line) => sum + line.total, 0).toFixed(2));
      const discount=Number(Number(body.discount||0).toFixed(2));
      if(!Number.isFinite(discount)||discount<0||discount>subtotal)throw Object.assign(new Error("Endirim məbləği düzgün deyil"),{statusCode:400});
      const [discountRule]=await tx.unsafe("select value from system_settings where key='max_discount_percent'");
      const maxPercent=Number(discountRule?.value??10);
      const discountPercent=subtotal?discount/subtotal*100:0;
      let approvedBy:string|null=null;
      if(discountPercent>maxPercent){
        const manager=await findManagerByPin(tx,String(body.managerPin||""));
        if(!manager)throw Object.assign(new Error(`Endirim ${maxPercent}% limitini keçir. Rəhbər PIN-i lazımdır`),{statusCode:403});
        approvedBy=manager.id;
      }
      let salesOrderId:string|null=null;
      if(body.salesOrderId){
        const [order]=await tx.unsafe("select id,status,customer_id from sales_orders where id=$1 for update",[body.salesOrderId]);
        if(!order)throw Object.assign(new Error("Satış sifarişi tapılmadı"),{statusCode:404});
        if(order.status!=="ready")throw Object.assign(new Error("Yalnız hazır sifariş kassada ödənilə bilər"),{statusCode:409});
        salesOrderId=order.id;
      }
      const total=Number((subtotal-discount).toFixed(2));
      const cashAmount=paymentMethod==='cash'?total:paymentMethod==='mixed'?Number(body.cashAmount):0;
      const cardAmount=paymentMethod==='card'?total:paymentMethod==='mixed'?Number(body.cardAmount):0;
      if(!Number.isFinite(cashAmount)||!Number.isFinite(cardAmount)||cashAmount<0||cardAmount<0||Math.abs(cashAmount+cardAmount-total)>.009)throw Object.assign(new Error("Nağd və kart məbləğlərinin cəmi yekuna bərabər olmalıdır"),{statusCode:400});
      const [{ next_no: nextNo }] = await tx.unsafe("select coalesce(max((regexp_replace(receipt_no, '[^0-9]', '', 'g'))::bigint),0)+1 as next_no from sales");
      const receiptNo = `#${String(nextNo).padStart(6, '0')}`;
      const [sale] = await tx.unsafe(
        "insert into sales (receipt_no, shift_id, cashier_id, customer_id, sales_order_id, subtotal, discount, total) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at",
        [receiptNo, shift.id, cashier.id, body.customerId||null, salesOrderId, subtotal,discount,total],
      );

      for (const line of lines) {
        await tx.unsafe(
          "insert into sale_items (sale_id, product_id, quantity, unit_price, cost_snapshot, line_total) values ($1,$2,$3,$4,$5,$6)",
          [sale.id, line.id, line.quantity, line.price, line.cost, line.total],
        );
        await tx.unsafe(
          `insert into stock_movements
            (product_id, warehouse_id, location_id, type, quantity, unit_cost, reference_type, reference_id, performed_by, note)
           values ($1,$2,$3,'sale',$4,$5,'sale',$6,$7,$8)`,
          [line.id, warehouse.id, line.locationId, -line.quantity, line.cost, sale.id, cashier.id, `${receiptNo} satışı`],
        );
      }
      if(salesOrderId)await tx.unsafe("update sales_orders set status='completed', updated_at=now() where id=$1",[salesOrderId]);
      if(cashAmount>0)await tx.unsafe("insert into payments (sale_id, method, amount) values ($1,'cash',$2)", [sale.id,cashAmount]);
      if(cardAmount>0)await tx.unsafe("insert into payments (sale_id, method, amount) values ($1,'card',$2)", [sale.id,cardAmount]);
      await tx.unsafe(
        "insert into audit_logs (user_id, action, entity_type, entity_id, after_json) values ($1,'sale.completed','sale',$2,$3)",
        [cashier.id, sale.id, JSON.stringify({ receiptNo, paymentMethod, subtotal,discount,total,customerId:body.customerId||null,salesOrderId,approvedBy,itemCount: lines.length })],
      );
      return { saleId: sale.id, receiptNo, total, paymentMethod, createdAt: sale.created_at };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("sale.create", error);void logSystemError("sale.create", error);
    return NextResponse.json({ error: error?.message || "Satış tamamlanmadı" }, { status: error?.statusCode || 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
