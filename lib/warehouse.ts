const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function salesWarehouseSql(userId=''){
 const id=uuid.test(userId)?userId:'00000000-0000-0000-0000-000000000000';
 return "select w.id,w.branch_id,w.name,w.code from users u join warehouses w on ("+
  "(u.branch_id=w.branch_id and ("+
   "(u.sales_warehouse_id is not null and w.id=u.sales_warehouse_id)"+
   " or (u.sales_warehouse_id is null and w.id::text=coalesce(nullif((select value from system_settings where key='sales_warehouse:'||u.branch_id::text),''),nullif((select value from system_settings where key='sales_warehouse_id'),''),''))"+
   " or (u.sales_warehouse_id is null and not exists(select 1 from system_settings where key='sales_warehouse:'||u.branch_id::text and value<>'') and (select count(*) from warehouses other where other.branch_id=u.branch_id)=1)"+
  ")) or (u.branch_id is null and u.sales_warehouse_id is null and (select count(*) from warehouses)=1)"+
 ") join branches b on b.id=w.branch_id and b.is_active=true where u.id='"+id+"' and u.is_active=true order by w.name limit 1";
}
