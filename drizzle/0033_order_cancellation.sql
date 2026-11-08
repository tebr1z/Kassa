ALTER TABLE sales_orders
 ADD COLUMN cancellation_reason text CHECK(cancellation_reason IS NULL OR char_length(cancellation_reason) BETWEEN 5 AND 500),
 ADD COLUMN cancelled_at timestamptz;
