CREATE SEQUENCE IF NOT EXISTS catalog_order_seq AS integer START 1001;
--> statement-breakpoint
WITH numbered AS (
 SELECT id, (1000 + row_number() OVER (ORDER BY created_at))::text AS n
 FROM sales_orders
 WHERE order_no LIKE 'WEB-%'
)
UPDATE sales_orders AS s
SET order_no = numbered.n
FROM numbered
WHERE s.id = numbered.id;
--> statement-breakpoint
SELECT setval('catalog_order_seq', GREATEST(1000, COALESCE((SELECT MAX(order_no::int) FROM sales_orders WHERE order_no ~ '^[0-9]+$'), 1000)));
