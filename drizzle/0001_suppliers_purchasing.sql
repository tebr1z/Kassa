CREATE TABLE "suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "address" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_no" text NOT NULL UNIQUE,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "status" text DEFAULT 'ordered' NOT NULL,
  "expected_date" date,
  "total" numeric(14,2) NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id"),
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "quantity" numeric(14,3) NOT NULL,
  "unit_cost" numeric(14,2) NOT NULL,
  "line_total" numeric(14,2) NOT NULL
);--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_items_order_idx" ON "purchase_order_items" ("purchase_order_id");
