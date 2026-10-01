// Payments and lines are aggregated separately: mixed payments must not duplicate items.
export const recentReceiptsSql = `
 select s.id,s.receipt_no,s.subtotal,s.discount,s.total,s.status,s.created_at,
 coalesce(s.receipt_store->>'cashier',u.full_name) full_name,o.order_no,
 coalesce(s.receipt_store,jsonb_build_object('name',coalesce(c.name,b.name),'phone',coalesce(c.phone,''),
 'address',coalesce(nullif(c.address,''),b.address,''),'branch',b.name,'register',coalesce(r.name,'Kassa'))) receipt_store,
 coalesce(pay.methods,'') payment_method,coalesce(pay.details,'[]'::json) payment_details,
 coalesce(lines.items,'[]'::json) items
 from sales s join users u on u.id=s.cashier_id
 join cashier_shifts cs on cs.id=s.shift_id
 join branches b on b.id=cs.branch_id
 left join storefront_config c on c.id=1
 left join sales_orders o on o.id=s.sales_order_id
 left join lateral (select name from cash_registers where branch_id=cs.branch_id and is_active=true order by created_at limit 1) r on true
 left join lateral (
  select string_agg(p.method,', ' order by p.method) as methods,
   json_agg(json_build_object('method',p.method,'amount',p.amount) order by p.method) details
  from payments p where p.sale_id=s.id
 ) pay on true
 left join lateral (
  select json_agg(json_build_object('name',coalesce(si.product_name_snapshot,pr.name),
   'quantity',si.quantity,'unitPrice',si.unit_price,'lineTotal',si.line_total) order by si.id) items
  from sale_items si join products pr on pr.id=si.product_id where si.sale_id=s.id
 ) lines on true
 where s.status in ('completed','returned') order by s.created_at desc limit 8
`;
