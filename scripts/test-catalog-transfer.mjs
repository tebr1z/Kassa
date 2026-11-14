import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { openLocalDatabase } from '../desktop/local-database.mjs';
import { readCatalog, importCatalog } from './catalog-transfer.mjs';

const run = randomUUID();
const databases = [], connections = [];
try {
  for (const [name, port] of [['source', 55436], ['target', 55437]]) {
    const database = await openLocalDatabase(path.resolve('.local-desktop-data', `catalog-${run}`, name), process.cwd(), { port });
    databases.push(database);
    connections.push(postgres(database.url, { max: 1, prepare: false }));
  }
  const [source, target] = connections;
  const [admin] = await source.unsafe('select id,branch_id from users limit 1');
  const [first] = await source.unsafe("update warehouses set code='TEST-A' returning id");
  const [second] = await source.unsafe("insert into warehouses(branch_id,name,code) values($1,'İkinci anbar','TEST-B') returning id", [admin.branch_id]);
  const [location] = await source.unsafe("insert into warehouse_locations(warehouse_id,code) values($1,'RƏF-1') returning id", [first.id]);
  const [product] = await source.unsafe("insert into products(sku,name,sale_price,cost_price,min_stock,public_code,description,discount_price) values('TEST-SKU','Ölçülü məhsul',25.50,12.25,1.125,'123456','Məlumat',22.50) returning id");
  await source.unsafe("insert into product_categories(name,image_url,show_on_home) values('Kateqoriya','https://example.test/category.jpg',true)");
  await source.unsafe("insert into product_barcodes(product_id,barcode,is_primary) values($1,'123456789',true)", [product.id]);
  await source.unsafe("insert into product_images(product_id,image_url,position) values($1,'https://example.test/photo.jpg',2)", [product.id]);
  await source.unsafe("insert into product_options(product_id,label,size,color,price,image_url) values($1,'Böyük','XL','Qara',30.75,'https://res.cloudinary.com/fixture/image/upload/black.png')", [product.id]);
  await source.unsafe("insert into stock_movements(product_id,warehouse_id,location_id,type,quantity,performed_by) values($1,$2,$3,'receipt',3.125,$4),($1,$5,null,'receipt',8.875,$4)", [product.id, first.id, location.id, admin.id, second.id]);
  await source.unsafe("update system_settings set value=$1 where key='sales_warehouse_id'", [second.id]);
  const catalog = await readCatalog(source);
  const identity = 'a'.repeat(64);
  const invalid = structuredClone(catalog);
  invalid.barcodes.push({ ...invalid.barcodes[0], id: randomUUID() });
  await assert.rejects(importCatalog(target, invalid, identity), error => error.code === '23505');
  const [rolledBack] = await target.unsafe('select (select count(*) from products) products,(select count(*) from warehouses) warehouses,(select count(*) from stock_movements) movements');
  assert.deepEqual({ ...rolledBack }, { products: '0', warehouses: '1', movements: '0' }, 'A barcode conflict must roll back products, warehouses and balances together');
  const unsafeImage=structuredClone(catalog);unsafeImage.options[0].image_url='javascript:alert(1)';
  await assert.rejects(importCatalog(target,unsafeImage,identity),/Seçim şəkli/,'Unsafe option photo must abort initial transfer atomically');
  const imported = await importCatalog(target, catalog, identity);
  assert.equal(imported.alreadyImported, false);
  assert.equal(imported.salesWarehouse, 'İkinci anbar');
  assert.deepEqual(imported.stockByWarehouse.map(row => row.quantity), ['3.125', '8.875']);
  for (const table of ['products', 'product_barcodes', 'product_images', 'product_options', 'product_categories']) {
    assert.deepEqual(await target.unsafe(`select * from ${table} order by id`), await source.unsafe(`select * from ${table} order by id`), table + ' fields must match');
  }
  const [localAdmin] = await target.unsafe('select id from users limit 1');
  await target.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,performed_by) values($1,$2,'sale',-1,$3)", [product.id, second.id, localAdmin.id]);
  assert.equal((await importCatalog(target, catalog, identity)).alreadyImported, true);
  const [balance] = await target.unsafe('select sum(quantity)::text quantity from stock_movements');
  assert.equal(balance.quantity, '11.000', 'Retry must preserve subsequent local sales');
  await assert.rejects(importCatalog(target, catalog, 'b'.repeat(64)), /boş deyil/);
  assert.deepEqual(await readCatalog(source), catalog, 'Source data must remain unchanged');
  console.log('PASS: full product fields, options, images, barcodes, separate warehouse/shelf balances, fractional quantities, sales warehouse, atomic rollback, replay without stock duplication, populated-target protection, unchanged source.');
} finally {
  for (const sql of connections) await sql.end({ timeout: 2 });
  for (const database of databases.reverse()) await database.close();
}
