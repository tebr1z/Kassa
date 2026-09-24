ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'AZN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Baku' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_registers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "name" text NOT NULL,
  "code" text NOT NULL UNIQUE,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
