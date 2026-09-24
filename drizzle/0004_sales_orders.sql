CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_no" text NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','ready','completed','cancelled')),
  "total" numeric(14,2) NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sales_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id"),
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "quantity" numeric(14,3) NOT NULL CHECK ("quantity" > 0),
  "unit_price" numeric(14,2) NOT NULL,
  "line_total" numeric(14,2) NOT NULL
);--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" ("status","created_at");--> statement-breakpoint
CREATE INDEX "sales_order_items_order_idx" ON "sales_order_items" ("sales_order_id");
