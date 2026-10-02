type Query = { unsafe: (query: string, params?: unknown[]) => Promise<{ [key: string]: unknown }[]> };
type Sql = { unsafe: Query["unsafe"]; begin: (fn: (tx: Query) => Promise<void>) => Promise<unknown> };

export function ean13(body12: string) {
  const sum = [...body12].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return body12 + String((10 - (sum % 10)) % 10);
}

export async function nextInternalBarcodes(tx: Query, count: number) {
  const [row] = await tx.unsafe("select coalesce(max(substring(barcode from 4 for 9)::bigint),0)::text as n from product_barcodes where barcode ~ '^200[0-9]{10}$'");
  let serial = Number(row?.n || 0);
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    serial += 1;
    if (serial > 999999999) throw new Error("Daxili barkod limiti doldu.");
    codes.push(ean13("200" + String(serial).padStart(9, "0")));
  }
  return codes;
}

export async function ensurePrimaryBarcodes(sql: Sql) {
  const [gap] = await sql.unsafe("select 1 as gap from products p where not exists (select 1 from product_barcodes b where b.product_id=p.id and b.is_primary) limit 1");
  if (!gap) return;
  await sql.begin(async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(842015)");
    await tx.unsafe(`update product_barcodes set is_primary=true where id in (
      select distinct on (pb.product_id) pb.id from product_barcodes pb
      where not exists (select 1 from product_barcodes b where b.product_id=pb.product_id and b.is_primary)
      order by pb.product_id, pb.barcode)`);
    const missing = await tx.unsafe("select p.id from products p where not exists (select 1 from product_barcodes b where b.product_id=p.id and b.is_primary) order by p.created_at, p.id");
    const codes = await nextInternalBarcodes(tx, missing.length);
    for (let index = 0; index < missing.length; index += 1) {
      await tx.unsafe("insert into product_barcodes (product_id, barcode, is_primary) values ($1,$2,true)", [missing[index].id, codes[index]]);
    }
  });
}

export async function savePrimaryBarcode(tx: Query, productId: string, barcode: string) {
  const value = barcode.trim();
  const [primary] = await tx.unsafe("select id, barcode from product_barcodes where product_id=$1 and is_primary=true", [productId]);
  if (!value) {
    if (primary) return String(primary.barcode);
    const [code] = await nextInternalBarcodes(tx, 1);
    await tx.unsafe("insert into product_barcodes (product_id, barcode, is_primary) values ($1,$2,true)", [productId, code]);
    return code;
  }
  if (value.length > 64) throw Object.assign(new Error("Barkod çox uzundur."), { statusCode: 400 });
  if (primary && String(primary.barcode) === value) return value;
  const [other] = await tx.unsafe("select id, product_id from product_barcodes where barcode=$1", [value]);
  if (other && String(other.product_id) !== productId) throw Object.assign(new Error("Bu barkod artıq başqa məhsuldadır."), { statusCode: 409 });
  if (other && String(other.id) !== String(primary?.id || "")) {
    if (primary) await tx.unsafe("update product_barcodes set is_primary=false where id=$1", [primary.id]);
    await tx.unsafe("update product_barcodes set is_primary=true where id=$1", [other.id]);
    return value;
  }
  if (primary) await tx.unsafe("update product_barcodes set barcode=$1 where id=$2", [value, primary.id]);
  else await tx.unsafe("insert into product_barcodes (product_id, barcode, is_primary) values ($1,$2,true)", [productId, value]);
  return value;
}
