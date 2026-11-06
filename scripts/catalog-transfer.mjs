import { createHash } from 'node:crypto';

const productColumns = ['id', 'sku', 'name', 'category', 'unit', 'sale_price', 'cost_price', 'min_stock', 'is_active', 'created_at', 'image_url', 'description', 'specifications', 'discount_price', 'public_code','deleted_at'];
const barcodeColumns = ['id', 'product_id', 'barcode', 'is_primary'];
const imageColumns = ['id', 'product_id', 'image_url', 'position'];
const optionColumns = ['id', 'product_id', 'label', 'size', 'color', 'kind', 'price', 'position', 'is_active', 'created_at','attributes','cost_price'];
const categoryColumns = ['id', 'name', 'is_active', 'image_url', 'show_on_home'];
const locationColumns = ['id', 'warehouse_id', 'code', 'zone', 'aisle', 'shelf', 'bin'];

export function sourceIdentity(url) {
  const parsed = new URL(url);
  return createHash('sha256').update(`${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`).digest('hex');
}

// A single read-only snapshot keeps prices, barcodes and opening balances consistent.
// No migrations, settings or other writes are ever sent to the source database.
export async function readCatalog(source) {
  return source.begin(async tx => {
    await tx.unsafe('set transaction isolation level repeatable read read only');
    const available = new Set((await tx.unsafe("select table_name from information_schema.tables where table_schema='public'")).map(row => row.table_name));
    const optional = table => available.has(table) ? tx.unsafe(`select * from ${table} order by id`) : [];
    return {
      products: await tx.unsafe('select * from products order by id'),
      barcodes: await tx.unsafe('select * from product_barcodes order by id'),
      images: await optional('product_images'),
      options: await optional('product_options'),
      categories: await optional('product_categories'),
      warehouses: await tx.unsafe('select * from warehouses order by code'),
      locations: await tx.unsafe('select * from warehouse_locations order by id'),
      balances: await tx.unsafe('select product_id,warehouse_id,location_id,sum(quantity)::text quantity from stock_movements group by product_id,warehouse_id,location_id having sum(quantity)<>0 order by product_id,warehouse_id,location_id'),
      settings: await tx.unsafe("select key,value from system_settings where key='sales_warehouse_id' or key like 'sales_warehouse:%'"),
    };
  });
}

export function catalogSummary(catalog) {
  return {
    products: catalog.products.length,
    activeProducts: catalog.products.filter(row => row.is_active).length,
    barcodes: catalog.barcodes.length,
    images: catalog.images.length,
    options: catalog.options.length,
    categories: catalog.categories.length,
    warehouses: catalog.warehouses.map(row => ({ code: row.code, name: row.name })),
  };
}

function balanceKey(row) { return [row.product_id, row.warehouse_id, row.location_id || ''].join('/'); }
function sortedBalances(rows) {
  return rows.map(row => `${balanceKey(row)}=${Number(row.quantity).toFixed(3)}`).sort();
}

// Initial transfer only: refusing a populated target prevents stock duplication or
// accidental overwrites of local prices. A committed marker makes retries a no-op.
export async function importCatalog(target, catalog, identity) {
  if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error('Yanlış mənbə identifikatoru.');
  return target.begin(async tx => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa-initial-catalog-transfer'))");
    const key = `desktop_catalog_import:${identity}`;
    const [previous] = await tx.unsafe('select value from system_settings where key=$1', [key]);
    if (previous) return { alreadyImported: true, ...JSON.parse(previous.value) };
    // Block simultaneous POS/catalog changes until the opening balances commit.
    await tx.unsafe('lock table products,product_barcodes,product_images,product_options,stock_movements,sales,warehouses,warehouse_locations,product_categories in share row exclusive mode');
    const [used] = await tx.unsafe('select (select count(*) from products)+(select count(*) from stock_movements)+(select count(*) from sales) n');
    if (Number(used.n)) throw new Error('Masaüstü baza boş deyil. Mövcud məhsul və stoku qorumaq üçün ilkin köçürmə dayandırıldı.');
    if (!catalog.products.length) throw new Error('Veb kataloqu boşdur.');
    const branches = new Set(catalog.warehouses.map(row => row.branch_id));
    if (branches.size !== 1) throw new Error('Bir neçə veb filialı var; əvvəlcə filial uyğunluğu müəyyən edilməlidir.');
    const [admin] = await tx.unsafe("select id,branch_id from users where role='admin' and is_active=true and branch_id is not null order by created_at,id limit 1");
    if (!admin) throw new Error('Masaüstündə filialı olan aktiv administrator tapılmadı.');
    const sourceBranch = [...branches][0];
    const chosen = catalog.settings.find(row => row.key === `sales_warehouse:${sourceBranch}`)?.value || catalog.settings.find(row => row.key === 'sales_warehouse_id')?.value;
    const salesWarehouse = catalog.warehouses.find(row => row.id === chosen) || (catalog.warehouses.length === 1 ? catalog.warehouses[0] : null);
    if (!salesWarehouse) throw new Error('Veb satış anbarı müəyyən edilməyib.');
    for (const category of catalog.categories) {
      await tx`insert into product_categories ${tx(category, categoryColumns)} on conflict (name) do nothing`;
    }
    for (const warehouse of catalog.warehouses) {
      await tx`insert into warehouses ${tx({ ...warehouse, branch_id: admin.branch_id }, ['id', 'branch_id', 'name', 'code'])}`;
    }
    for (const location of catalog.locations) await tx`insert into warehouse_locations ${tx(location, locationColumns)}`;
    for (const product of catalog.products) await tx`insert into products ${tx({...product,deleted_at:product.deleted_at||null}, productColumns)}`;
    for (const barcode of catalog.barcodes) await tx`insert into product_barcodes ${tx(barcode, barcodeColumns)}`;
    for (const image of catalog.images) await tx`insert into product_images ${tx(image, imageColumns)}`;
    for (const option of catalog.options) await tx`insert into product_options ${tx({...option,attributes:option.attributes||{},cost_price:option.cost_price??null}, optionColumns)}`;
    const costs = new Map(catalog.products.map(row => [row.id, row.cost_price]));
    for (const balance of catalog.balances) {
      await tx`insert into stock_movements ${tx({
        ...balance, type: 'adjustment', unit_cost: costs.get(balance.product_id),
        reference_type: 'web_catalog_opening', performed_by: admin.id,
        note: 'Veb kataloqundan ilkin stok köçürməsi. Keçmiş satışlar köçürülməyib.',
      }, ['product_id', 'warehouse_id', 'location_id', 'quantity', 'type', 'unit_cost', 'reference_type', 'performed_by', 'note'])}`;
    }
    const balances = await tx.unsafe('select product_id,warehouse_id,location_id,sum(quantity)::text quantity from stock_movements group by product_id,warehouse_id,location_id having sum(quantity)<>0');
    if (JSON.stringify(sortedBalances(balances)) !== JSON.stringify(sortedBalances(catalog.balances))) throw new Error('Stok yoxlaması uğursuzdur; köçürmə geri qaytarıldı.');
    for (const setting of ['sales_warehouse_id', `sales_warehouse:${admin.branch_id}`]) {
      await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [setting, salesWarehouse.id]);
    }
    const result = {
      ...catalogSummary(catalog), appliedAt: new Date().toISOString(),
      stockBalances: balances.length, salesWarehouse: salesWarehouse.name,
      stockByWarehouse: await tx.unsafe("select w.code,w.name,coalesce(sum(sm.quantity),0)::text quantity from warehouses w left join stock_movements sm on sm.warehouse_id=w.id where w.id=any($1::uuid[]) group by w.id order by w.code", [catalog.warehouses.map(row => row.id)]),
    };
    await tx.unsafe('insert into system_settings(key,value) values($1,$2)', [key, JSON.stringify(result)]);
    await tx.unsafe("insert into audit_logs(user_id,action,entity_type,after_json) values($1,'web_catalog_import','products',$2)", [admin.id, JSON.stringify(result)]);
    return { alreadyImported: false, ...result };
  });
}
