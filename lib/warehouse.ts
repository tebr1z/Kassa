const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function salesWarehouseSql(userId = "") {
  const id = userIdPattern.test(userId) ? userId : "00000000-0000-0000-0000-000000000000";
  return `select id, branch_id, name, code from (
select w.id, w.branch_id, w.name, w.code, 0 as rank
from warehouses w
where (
  w.branch_id = (select branch_id from users where id = '${id}')
  and (
    w.id::text = coalesce(
      nullif((select value from system_settings where key = 'sales_warehouse:' || (select branch_id::text from users where id = '${id}')), ''),
      (select value from system_settings where key = 'sales_warehouse_id' and exists (select 1 from warehouses chosen where chosen.id::text = system_settings.value and chosen.branch_id = (select branch_id from users where id = '${id}')))
    , '')
    or (
      coalesce(nullif((select value from system_settings where key = 'sales_warehouse:' || (select branch_id::text from users where id = '${id}')), ''), '') = ''
      and (select count(*) from warehouses wb where wb.branch_id = w.branch_id) = 1
    )
  )
) or (
  (select branch_id from users where id = '${id}') is null
  and (
    w.id::text = coalesce((select value from system_settings where key='sales_warehouse_id'), '')
    or (
      coalesce((select value from system_settings where key='sales_warehouse_id'), '') = ''
      and (select count(*) from warehouses) = 1
    )
  )
)
union all
select w.id, w.branch_id, w.name, w.code, 1 as rank
from warehouses w
join users u on u.id = '${id}' and u.role = 'admin'
order by rank, name
limit 1) chosen`;
}
