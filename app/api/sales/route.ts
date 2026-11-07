import {optionSnapshot} from "@/lib/product-options";
import {withAdminSession} from '@/lib/require-admin';
import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { findManagerByPin } from "@/lib/pin";
import { salesWarehouseSql } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaleItemInput = { productId?: string; optionId?:string|null; quantity?: number | string };

function connection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
}

async function handlePOST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as { items?: SaleItemInput[]; paymentMethod?: string; cashAmount?:number|string; cardAmount?:number|string; discount?:number|string; customerId?:string; buyerName?:string; salesOrderId?:string; managerPin?:string };
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
      const optionId=item.optionId?String(item.optionId):"";
      merged.set(`${productId}:${optionId}`, (merged.get(`${productId}:${optionId}`) || 0) + quantity);
    }

    const result = await sql.begin(async (tx) => {
      const [warehouse] = await tx.unsafe(salesWarehouseSql(request.headers.get("x-birkassa-user-id") || ""));
      const userId=request.headers.get("x-birkassa-user-id");
      const [cashier] = await tx.unsafe("select id,full_name from users where id=$1 and is_active=true",[userId]);
      if (!cashier) throw Object.assign(new Error("İstifadəçi sessiyası tapılmadı"), { statusCode: 401 });
      if (!warehouse) throw Object.assign(new Error("Kassirə mağaza və satış anbarı təyin edin"), { statusCode: 409 });

      const [shift] = await tx.unsafe(
        "select id,branch_id from cashier_shifts where cashier_id=$1 and closed_at is null order by opened_at desc limit 1",
        [cashier.id],
      );
      if (!shift) throw Object.assign(new Error("Satış üçün əvvəlcə kassa növbəsini açın"), { statusCode: 409 });
      if(shift.branch_id!==warehouse.branch_id)throw Object.assign(new Error('Növbənin mağazası dəyişib. Növbəni bağlayıb düzgün mağazada yenidən açın.'),{statusCode:409});

      let linkedOrder: {id:string;status:string;customer_id:string;source:string;coupon_discount:string;delivery_fee:string}|undefined;
      let orderLines: {product_id:string;option_id:string|null;option_snapshot:string|null;quantity:string;unit_price:string}[]=[];
      if(body.salesOrderId){
       [linkedOrder]=await tx.unsafe("select id,status,customer_id,source,coupon_discount,delivery_fee from sales_orders where id=$1 for update",[body.salesOrderId]) as unknown as typeof linkedOrder[];
       if(!linkedOrder||linkedOrder.status!=="ready")throw Object.assign(new Error("Yalnız hazır sifariş ödənilə bilər"),{statusCode:409});
       orderLines=await tx.unsafe("select product_id,option_id,option_snapshot,quantity,unit_price from sales_order_items where sales_order_id=$1",[linkedOrder.id]) as unknown as typeof orderLines;
       if(orderLines.length!==merged.size||orderLines.some(l=>merged.get(`${l.product_id}:${l.option_id||""}`)!==Number(l.quantity)))throw Object.assign(new Error("Sifariş məhsulları, seçimləri və miqdarı dəyişdirilə bilməz"),{statusCode:409});
      }
      const lines: Array<{ id:string; sku:string; name:string; optionId:string|null; optionLabel:string; quantity:number; price:number; cost:number; total:number; locationId:string|null }> = [];
      for (const [lineKey, quantity] of [...merged].sort()) {
        const [productId,optionIdRaw]=lineKey.split(":");
        const optionId=optionIdRaw||null;
        const [product] = await tx.unsafe(
          "select id, sku, name, sale_price, cost_price from products where id=$1 and is_active=true for update",
          [productId],
        );
        if (!product) throw Object.assign(new Error("Məhsul tapılmadı"), { statusCode: 404 });
        let option:null|{id:string;label:string;price:string|null;cost_price?:string|null;attributes?:Record<string,string>}=null;
        if(optionId){[option]=await tx.unsafe("select id,label,price,attributes,cost_price from product_options where id=$1 and product_id=$2 and is_active=true",[optionId,product.id]);if(!option)throw Object.assign(new Error(`${product.name}: seçilmiş ölçü/rəng artıq aktiv deyil`),{statusCode:409});}
        const hasOptions=Number((await tx.unsafe("select count(*) n from product_options where product_id=$1 and is_active=true",[product.id]))[0]?.n||0)>0;
        if(hasOptions&&!option)throw Object.assign(new Error(`${product.name}: ölçü, rəng və ya növ seçin`),{statusCode:400});
        const [balance] = await tx.unsafe(
          "select coalesce(sum(quantity),0) as stock from stock_movements where product_id=$1 and warehouse_id=$2",
          [product.id, warehouse.id],
        );
        const stock = Number(balance.stock);
        const productQuantity=[...merged].filter(([key])=>key.split(":")[0]===productId).reduce((n,[,q])=>n+q,0);
        if (stock < productQuantity) {
          throw Object.assign(new Error(`${product.name}: stokda yalnız ${stock} ədəd var`), { statusCode: 409 });
        }
        const [location] = await tx.unsafe(
          "select location_id from stock_movements where product_id=$1 and warehouse_id=$2 and location_id is not null order by created_at desc limit 1",
          [product.id, warehouse.id],
        );
        const orderLine=linkedOrder?orderLines.find(l=>l.product_id===productId&&(l.option_id||null)===optionId):undefined;
        const price = orderLine?Number(orderLine.unit_price):option?.price!=null?Number(option.price):Number(product.sale_price);
        lines.push({ id: product.id, sku:product.sku, name: product.name, optionId, optionLabel:orderLine?.option_snapshot||(option?optionSnapshot(option):""), quantity, price, cost: Number(option?.cost_price??product.cost_price), total: price * quantity, locationId: location?.location_id || null });
      }

      const subtotal = Number(lines.reduce((sum, line) => sum + line.total, 0).toFixed(2));
      const discount=linkedOrder?.source==="catalog"?Number(linkedOrder.coupon_discount):Number(Number(body.discount||0).toFixed(2));
      if(!Number.isFinite(discount)||discount<0||discount>subtotal)throw Object.assign(new Error("Endirim məbləği düzgün deyil"),{statusCode:400});
      const [discountRule]=await tx.unsafe("select value from system_settings where key='max_discount_percent'");
      const maxPercent=Number(discountRule?.value??10);
      const discountPercent=subtotal?discount/subtotal*100:0;
      let approvedBy:string|null=null;
      if(discountPercent>maxPercent&&linkedOrder?.source!=="catalog"){
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
      // Delivery is a server-owned order charge, never a client-controlled product line.
      const deliveryFee=Number(linkedOrder?.delivery_fee??0);
      if(!Number.isFinite(deliveryFee)||deliveryFee<0)throw Object.assign(new Error('Sifarişin çatdırılma məbləğini yoxlayın.'),{statusCode:409});
      const total=Number((subtotal-discount+deliveryFee).toFixed(2));
      const cashAmount=paymentMethod==='cash'?total:paymentMethod==='mixed'?Number(body.cashAmount):0;
      const cardAmount=paymentMethod==='card'?total:paymentMethod==='mixed'?Number(body.cardAmount):0;
      if(!Number.isFinite(cashAmount)||!Number.isFinite(cardAmount)||cashAmount<0||cardAmount<0||Math.abs(cashAmount+cardAmount-total)>.009)throw Object.assign(new Error("Nağd və kart məbləğlərinin cəmi yekuna bərabər olmalıdır"),{statusCode:400});
      const [brand]=await tx.unsafe("select name,phone,address from storefront_config where id=1");
      const [branch]=await tx.unsafe("select name,address from branches where id=$1",[shift.branch_id]);
      const [register]=await tx.unsafe("select name from cash_registers where branch_id=$1 and is_active=true order by created_at limit 1",[shift.branch_id]);
      const receiptStore={name:brand?.name||branch?.name||"Mağaza",phone:brand?.phone||"",address:brand?.address||branch?.address||"",branch:branch?.name||"",register:register?.name||"Kassa",cashier:cashier.full_name};
      await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.receipt-number'))");
      const [{ next_no: nextNo }] = await tx.unsafe("select coalesce(max((regexp_replace(receipt_no, '[^0-9]', '', 'g'))::bigint),0)+1 as next_no from sales");
      const receiptNo = `#${String(nextNo).padStart(6, '0')}`;
      const [sale] = await tx.unsafe(
        "insert into sales (receipt_no, shift_id, cashier_id, customer_id, sales_order_id, buyer_name, subtotal, discount, total, receipt_store, delivery_fee) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb,$11) returning id, created_at",
        [receiptNo, shift.id, cashier.id, linkedOrder?.customer_id||body.customerId||null, salesOrderId, String(body.buyerName||"").trim()||null, subtotal,discount,total,JSON.stringify(receiptStore),deliveryFee],
      );

      for (const line of lines) {
        await tx.unsafe(
          "insert into sale_items (sale_id, product_id, option_id, option_snapshot, quantity, unit_price, cost_snapshot, line_total, product_name_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [sale.id, line.id, line.optionId, line.optionLabel||null, line.quantity, line.price, line.cost, line.total,line.name],
        );
        await tx.unsafe(
          `insert into stock_movements
            (product_id, warehouse_id, location_id, type, quantity, unit_cost, reference_type, reference_id, performed_by, note)
           values ($1,$2,$3,'sale',$4,$5,'sale',$6,$7,$8)`,
          [line.id, warehouse.id, line.locationId, -line.quantity, line.cost, sale.id, cashier.id, `${receiptNo} satışı`],
        );
      }
      if(salesOrderId)await tx.unsafe("update sales_orders set status='completed',delivery_stage=case when fulfillment='pickup' then 'delivered' else delivery_stage end,updated_at=now() where id=$1",[salesOrderId]);
      if(cashAmount>0)await tx.unsafe("insert into payments (sale_id, method, amount) values ($1,'cash',$2)", [sale.id,cashAmount]);
      if(cardAmount>0)await tx.unsafe("insert into payments (sale_id, method, amount) values ($1,'card',$2)", [sale.id,cardAmount]);
      await tx.unsafe(
        "insert into audit_logs (user_id, action, entity_type, entity_id, after_json) values ($1,'sale.completed','sale',$2,$3)",
        [cashier.id, sale.id, JSON.stringify({ receiptNo, paymentMethod, subtotal,discount,deliveryFee,total,customerId:body.customerId||null,salesOrderId,approvedBy,itemCount: lines.length })],
      );
      return { saleId: sale.id, receiptNo, total, deliveryFee, paymentMethod, createdAt: sale.created_at,receipt:{id:sale.id,receiptNo,total,subtotal,discount,deliveryFee,status:"completed",createdAt:sale.created_at,cashier:cashier.full_name,buyerName:String(body.buyerName||"").trim(),paymentMethod,store:receiptStore,paymentDetails:[{method:"cash",amount:cashAmount},{method:"card",amount:cardAmount}].filter(p=>p.amount>0),items:lines.map(line=>({code:line.sku,name:line.name,optionLabel:line.optionLabel,quantity:line.quantity,unitPrice:line.price,lineTotal:line.total}))} };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("sale.create", error);void logSystemError("sale.create", error);
    return NextResponse.json({ error: error?.statusCode ? error.message : "Satış tamamlanmadı" }, { status: error?.statusCode || 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export const POST=withAdminSession(handlePOST);
