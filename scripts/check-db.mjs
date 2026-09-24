import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });
try {
  const result = await sql.unsafe(`
    select current_database() as database,
           current_user as username,
           current_schema() as schema,
           has_database_privilege(current_user, current_database(), 'CREATE') as database_create,
           has_schema_privilege(current_user, 'public', 'CREATE') as public_create,
           has_schema_privilege(current_user, 'public', 'USAGE') as public_usage
  `);
  console.log(JSON.stringify(result));
  const tables = await sql.unsafe(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'branches', 'users', 'warehouses', 'warehouse_locations',
        'products', 'product_barcodes', 'stock_movements', 'cashier_shifts',
        'sales', 'sale_items', 'payments', 'audit_logs', '__drizzle_migrations'
      )
    order by table_name
  `);
  console.log(JSON.stringify({ tableCount: tables.length, tables }));
} finally {
  await sql.end({ timeout: 1 });
}
