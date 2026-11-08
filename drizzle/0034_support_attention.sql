-- Fail promptly rather than partially waiting on a live support writer. The
-- deployment runner applies this migration in one transaction, before new code.
LOCK TABLE support_tickets,support_ticket_messages IN ACCESS EXCLUSIVE MODE NOWAIT;
--> statement-breakpoint
ALTER TABLE support_tickets
 ADD COLUMN customer_revision bigint NOT NULL DEFAULT 0 CHECK(customer_revision>=0),
 ADD COLUMN staff_read_revision bigint NOT NULL DEFAULT 0 CHECK(staff_read_revision>=0);
--> statement-breakpoint
UPDATE support_tickets t SET customer_revision=(SELECT count(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.sender='customer');
--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_ticket_read_revision_check CHECK(staff_read_revision<=customer_revision);
--> statement-breakpoint
-- now() is transaction-start time and can put a newly committed reply before
-- the answer it waited for. Real insertion time preserves conversation order.
ALTER TABLE support_ticket_messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();
--> statement-breakpoint
CREATE FUNCTION support_customer_attention() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.sender='customer' THEN
  IF TG_OP='INSERT' THEN
   UPDATE public.support_tickets SET customer_revision=customer_revision+1 WHERE id=NEW.ticket_id;
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
   UPDATE public.support_tickets SET customer_revision=customer_revision+1 WHERE id=NEW.ticket_id;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER support_customer_attention_trigger AFTER INSERT OR UPDATE OF body ON support_ticket_messages FOR EACH ROW EXECUTE FUNCTION support_customer_attention();
--> statement-breakpoint
CREATE INDEX support_tickets_unread_time_idx ON support_tickets(updated_at DESC) WHERE customer_revision>staff_read_revision;
--> statement-breakpoint
CREATE INDEX support_ticket_messages_latest_idx ON support_ticket_messages(ticket_id,created_at DESC,id DESC);
