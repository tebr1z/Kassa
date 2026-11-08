CREATE TABLE smtp_settings (
 id smallint PRIMARY KEY CHECK(id=1),
 enabled boolean NOT NULL DEFAULT false,
 provider text NOT NULL DEFAULT 'custom' CHECK(provider IN ('gmail','custom')),
 host text NOT NULL DEFAULT '',
 port integer NOT NULL DEFAULT 465 CHECK(port IN (465,587)),
 security text NOT NULL DEFAULT 'tls' CHECK(security IN ('tls','starttls')),
 username text NOT NULL DEFAULT '',
 from_email text NOT NULL DEFAULT '',
 from_name text NOT NULL DEFAULT 'RestaMarket',
 reply_to text NOT NULL DEFAULT '',
 password_cipher text,
 revision integer NOT NULL DEFAULT 0,
 last_test_at timestamptz,
 last_test_status text CHECK(last_test_status IN ('verified','sent','failed')),
 last_error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((port=465 AND security='tls') OR (port=587 AND security='starttls'))
);
INSERT INTO smtp_settings(id) VALUES(1);
--> statement-breakpoint
CREATE TABLE smtp_test_rate (
 id smallint PRIMARY KEY CHECK(id=1),
 next_test_at timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO smtp_test_rate(id) VALUES(1);
--> statement-breakpoint
-- Delivery evidence only: no message body, recipient or SMTP credentials here.
-- A stable event key prevents a repeated order/reply request sending twice.
CREATE TABLE smtp_deliveries (
 event_key text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('order_cancelled','support_reply')),
 status text NOT NULL CHECK(status IN ('sending','sent','failed')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smtp_deliveries_status_time ON smtp_deliveries(status,updated_at);
REVOKE ALL ON smtp_settings,smtp_test_rate,smtp_deliveries FROM PUBLIC;
