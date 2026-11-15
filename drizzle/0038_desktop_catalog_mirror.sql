-- Public catalogue identities only. Stock, costs, barcodes and credentials are
-- deliberately absent; existing local product/option identities remain intact.
CREATE TABLE desktop_web_catalog_map (
 store_url text NOT NULL,
 remote_id uuid NOT NULL,
 local_product_id uuid NOT NULL REFERENCES products(id),
 remote_payload jsonb NOT NULL CHECK(jsonb_typeof(remote_payload)='object'),
 review_required boolean NOT NULL DEFAULT false,
 conflicts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(conflicts)='array'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_url,remote_id),
 UNIQUE(store_url,local_product_id)
);
