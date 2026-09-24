CREATE TABLE "product_price_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "old_sale_price" numeric(14,2) NOT NULL,
  "new_sale_price" numeric(14,2) NOT NULL,
  "old_cost_price" numeric(14,2) NOT NULL,
  "new_cost_price" numeric(14,2) NOT NULL,
  "changed_by" uuid NOT NULL REFERENCES "users"("id"),
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "product_price_history_product_idx" ON "product_price_history" ("product_id","changed_at");
