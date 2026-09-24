import "dotenv/config";
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");

const items = [
  ["ICK-001", "Coca-Cola 500 ml", "İçkilər", "5449000054227", 1.50, 0.92, 12, 48, "A-01-R2-G04"],
  ["ICK-014", "Sirab qazsız 500 ml", "İçkilər", "4760035001678", 0.80, 0.42, 15, 8, "A-01-R1-G02"],
  ["ERZ-108", "Azərçay Buket 100 q", "Ərzaq", "4760033000116", 4.20, 3.10, 10, 31, "B-02-R3-G01"],
  ["SUD-022", "Milla süd 1 L", "Süd məhsulları", "4760085100161", 2.60, 1.85, 10, 6, "S-01-R1-G08"],
  ["EV-044", "Papi salfet 100-lük", "Ev üçün", "8690530034122", 2.10, 1.30, 8, 22, "C-03-R2-G06"],
  ["SIR-009", "Snickers 50 q", "Şirniyyat", "5000159461122", 1.70, 1.05, 18, 54, "A-02-R4-G02"],
];

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
try {
  await sql.begin(async (tx) => {
    let [branch] = await tx.unsafe("select id from branches where name = $1 limit 1", ["Əsas mağaza"]);
    if (!branch) [branch] = await tx.unsafe("select id from branches where name = $1 limit 1", ["Baş mağaza"]);
    if (!branch) [branch] = await tx.unsafe("insert into branches (name, address) values ($1, $2) returning id", ["Əsas mağaza", "Bakı şəhəri"]);
    let [second] = await tx.unsafe("select id from branches where name = $1 limit 1", ["İkinci mağaza"]);
    if (!second) [second] = await tx.unsafe("insert into branches (name, address) values ($1, $2) returning id", ["İkinci mağaza", "Bakı şəhəri"]);

    let [warehouse] = await tx.unsafe("select id from warehouses where code in ('ESAS','ANB-01') order by case when code='ESAS' then 0 else 1 end limit 1");
    if (!warehouse) [warehouse] = await tx.unsafe("insert into warehouses (branch_id, name, code) values ($1, $2, $3) returning id", [branch.id, "Əsas mağaza anbarı", "ESAS"]);
    const [secondWarehouse] = await tx.unsafe("select id from warehouses where code = 'IKINCI' limit 1");
    if (!secondWarehouse) await tx.unsafe("insert into warehouses (branch_id, name, code) values ($1, $2, $3)", [second.id, "İkinci mağaza anbarı", "IKINCI"]);
    const [central] = await tx.unsafe("select id from warehouses where code in ('MERKEZ','MAGAZA','MAG-01') limit 1");
    if (!central) await tx.unsafe("insert into warehouses (branch_id, name, code) values ($1, $2, $3)", [branch.id, "Mərkəzi anbar", "MERKEZ"]);

    let [user] = await tx.unsafe("select id from users where full_name = $1 limit 1", ["Sistem Administratoru"]);
    if (!user) [user] = await tx.unsafe("insert into users (branch_id, full_name, role) values ($1, $2, $3) returning id", [branch.id, "Sistem Administratoru", "admin"]);
    const [secondRow] = await tx.unsafe("select id from warehouses where code='IKINCI' limit 1");
    await tx.unsafe("insert into system_settings (key, value, updated_by) values ('sales_warehouse_id', $1, $2) on conflict (key) do nothing", [warehouse.id, user.id]);
    await tx.unsafe("insert into system_settings (key, value, updated_by) values ($1, $2, $3) on conflict (key) do nothing", ["sales_warehouse:"+branch.id, warehouse.id, user.id]);
    if (secondRow) await tx.unsafe("insert into system_settings (key, value, updated_by) values ($1, $2, $3) on conflict (key) do nothing", ["sales_warehouse:"+second.id, secondRow.id, user.id]);

    for (const [sku, name, category, barcode, salePrice, costPrice, minStock, quantity, locationCode] of items) {
      const [product] = await tx.unsafe(
        `insert into products (sku, name, category, sale_price, cost_price, min_stock)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (sku) do update set name=excluded.name, category=excluded.category,
           sale_price=excluded.sale_price, cost_price=excluded.cost_price, min_stock=excluded.min_stock
         returning id`,
        [sku, name, category, salePrice, costPrice, minStock],
      );
      await tx.unsafe(
        `insert into product_barcodes (product_id, barcode, is_primary) values ($1,$2,true)
         on conflict (barcode) do update set product_id=excluded.product_id, is_primary=true`,
        [product.id, barcode],
      );
      let [location] = await tx.unsafe("select id from warehouse_locations where warehouse_id=$1 and code=$2 limit 1", [warehouse.id, locationCode]);
      if (!location) [location] = await tx.unsafe("insert into warehouse_locations (warehouse_id, code) values ($1,$2) returning id", [warehouse.id, locationCode]);
      const [movement] = await tx.unsafe("select id from stock_movements where product_id=$1 and reference_type='opening_balance' limit 1", [product.id]);
      if (!movement) await tx.unsafe(
        `insert into stock_movements (product_id, warehouse_id, location_id, type, quantity, unit_cost, reference_type, performed_by, note)
         values ($1,$2,$3,'receipt',$4,$5,'opening_balance',$6,$7)`,
        [product.id, warehouse.id, location.id, quantity, costPrice, user.id, "İlkin anbar qalığı"],
      );
    }
  });
  console.log("Initial data is ready.");
} finally {
  await sql.end({ timeout: 5 });
}
