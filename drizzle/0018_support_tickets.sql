CREATE SEQUENCE IF NOT EXISTS support_ticket_seq AS integer START 1001;
--> statement-breakpoint
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_no text NOT NULL UNIQUE,
 account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 subject text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('problem','suggestion','order')),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX support_tickets_account_time ON support_tickets (account_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE support_ticket_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 sender text NOT NULL CHECK (sender IN ('customer','staff')),
 body text NOT NULL,
 staff_user_id uuid,
 edited_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX support_ticket_messages_ticket_time ON support_ticket_messages (ticket_id, created_at);
--> statement-breakpoint
INSERT INTO support_tickets (ticket_no, account_id, subject, kind, status, created_at, updated_at)
SELECT (1000 + row_number() OVER (ORDER BY min(created_at)))::text, account_id, 'Əvvəlki yazışma', 'problem',
 CASE WHEN bool_or(sender = 'staff') THEN 'answered' ELSE 'open' END, min(created_at), max(created_at)
FROM customer_chat_messages
GROUP BY account_id;
--> statement-breakpoint
INSERT INTO support_ticket_messages (ticket_id, sender, body, staff_user_id, created_at)
SELECT t.id, m.sender, m.body, m.staff_user_id, m.created_at
FROM customer_chat_messages m
JOIN support_tickets t ON t.account_id = m.account_id AND t.subject = 'Əvvəlki yazışma';
--> statement-breakpoint
SELECT setval('support_ticket_seq', GREATEST(1000, COALESCE((SELECT MAX(ticket_no::int) FROM support_tickets WHERE ticket_no ~ '^[0-9]+$'), 1000)));
