ALTER TABLE support_tickets ALTER COLUMN account_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_name text;
--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_phone text;
--> statement-breakpoint
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_person_check;
--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_person_check CHECK (account_id IS NOT NULL OR (guest_name IS NOT NULL AND guest_phone IS NOT NULL AND char_length(btrim(guest_name)) BETWEEN 2 AND 80 AND char_length(guest_phone) BETWEEN 9 AND 15));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_guest_phone_time ON support_tickets (guest_phone, created_at DESC);
