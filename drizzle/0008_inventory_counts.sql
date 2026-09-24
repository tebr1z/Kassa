CREATE TABLE "inventory_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "count_no" text NOT NULL UNIQUE,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "status" text DEFAULT 'completed' NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "inventory_count_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_count_id" uuid NOT NULL REFERENCES "inventory_counts"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "system_quantity" numeric(14,3) NOT NULL,
  "actual_quantity" numeric(14,3) NOT NULL,
  "difference" numeric(14,3) NOT NULL
);--> statement-breakpoint
CREATE INDEX "inventory_counts_created_idx" ON "inventory_counts" ("created_at");
