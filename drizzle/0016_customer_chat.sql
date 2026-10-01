CREATE TABLE customer_chat_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 sender text NOT NULL CHECK (sender IN ('customer','staff')),
 body text NOT NULL,
 staff_user_id uuid,
 seen boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX customer_chat_account_time ON customer_chat_messages (account_id, created_at);
