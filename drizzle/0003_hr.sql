ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "salary" numeric(14,2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hired_at" date DEFAULT current_date;--> statement-breakpoint
CREATE TABLE "employee_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "clock_in" timestamp with time zone DEFAULT now() NOT NULL,
  "clock_out" timestamp with time zone,
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id")
);--> statement-breakpoint
CREATE INDEX "employee_attendance_user_idx" ON "employee_attendance" ("user_id","clock_in");
