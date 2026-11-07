import "server-only";
import {createHash, timingSafeEqual} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {storeDb} from "@/lib/store-db";
import {pushDesktopChanges} from "@/lib/desktop-bridge";
import {cacheProductMedia} from "@/lib/desktop-media";

export const isDesktop = () => process.env.BIRKASSA_LOCAL === "1";
export const feedKeyName = "desktop_order_feed_key_hash";
export const desktopDeliveryUpgradeMessage='Masaüstü tətbiqi yeniləyin. Çatdırılma haqqı olan sifarişlər köhnə kassaya köçürülmür.';
export const isDeliveryUpgradeError=(error:unknown)=>error instanceof Error&&'deliveryUpgrade' in error&&error.deliveryUpgrade===true;
export const hashKey = (key:string) => createHash("sha256").update(key).digest("hex");
export function matchesKey(key:string, hash:string) {
  return /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(hashKey(key), "hex"), Buffer.from(hash, "hex"));
}
const configPath = () => path.join(process.env.BIRKASSA_DATA_DIR || process.cwd(), ".private", "desktop-sync.json");
type Config = {url:string;key:string};
export async function readSyncConfig():Promise<Config|null> {
  try { return JSON.parse(await readFile(configPath(), "utf8")) as Config; }
  catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT")return null;throw error; }
}
export async function writeSyncConfig(config:Config|null) {
  await mkdir(path.dirname(configPath()), {recursive:true});
  const temporary = configPath()+".tmp";
  await writeFile(temporary, JSON.stringify(config), {mode:0o600});
  await rename(temporary, configPath());
}
export function normalizeStoreUrl(value:string) {
  const url = new URL(value);
  if(url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Mağazanın HTTPS ünvanını yazın.");
  }
  return url.origin;
}
const amount = z.coerce.number().finite().min(0).max(999999999999);
export const remoteOrderSchema = z.object({
  id:z.string().uuid(), order_no:z.string().max(150), status:z.enum(["pending","ready","completed","cancelled"]),
  fulfillment:z.enum(["pickup","delivery"]), delivery_address:z.string().nullable(), delivery_stage:z.string(),
  total:amount, coupon_discount:amount,delivery_fee:amount.default(0),
  distance_meters:z.coerce.number().finite().int().min(0).nullable().default(null),
  delivery_lat:z.coerce.number().finite().min(-90).max(90).nullable().default(null),
  delivery_lng:z.coerce.number().finite().min(-180).max(180).nullable().default(null),
  delivery_pricing:z.enum(['manual','distance']).default('manual'),
  note:z.string().nullable(), full_name:z.string(), phone:z.string().nullable(),
  created_at:z.string(), updated_at:z.string(),
  items:z.array(z.object({sku:z.string(), name:z.string(), option_snapshot:z.string().nullable(),
    quantity:z.coerce.number().finite().positive().max(999999999), unit_price:amount, line_total:amount})).min(1).max(500)
}).superRefine((order,context)=>{
 const subtotal=order.items.reduce((sum,item)=>sum+item.line_total,0);
 if(order.coupon_discount>subtotal||Math.abs(order.total-Number((subtotal-order.coupon_discount+order.delivery_fee).toFixed(2)))>.009)context.addIssue({code:z.ZodIssueCode.custom,path:['total'],message:'Sifarişin məhsul, endirim və çatdırılma məbləğləri uyğun deyil.'});
 if(order.fulfillment==='pickup'&&order.delivery_fee!==0)context.addIssue({code:z.ZodIssueCode.custom,path:['delivery_fee'],message:'Mağazadan götürmə üçün çatdırılma haqqı ola bilməz.'});
});
export type RemoteOrder = z.infer<typeof remoteOrderSchema>;
const pageSchema = z.object({rows:z.array(remoteOrderSchema).max(100), next:z.string().max(1000).nullable()});
export async function fetchOrderPage(config:Config, cursor="") {
  const response = await fetch(config.url+"/api/desktop-feed"+(cursor?"?after="+encodeURIComponent(cursor):""), {
    headers:{Authorization:"Bearer "+config.key,'X-Restamarket-Delivery':'1'},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)
  });
  if(response.status===409)throw Object.assign(new Error(desktopDeliveryUpgradeMessage),{deliveryUpgrade:true});
  if(!response.ok)throw new Error(response.status===401?"Bağlantı açarı etibarsızdır.":"Mağaza ilə əlaqə qurulmadı.");
  return pageSchema.parse(await response.json());
}
let inFlight:Promise<{received:number}>|null = null;
export function syncOrders() {
  if(inFlight)return inFlight;
  void cacheProductMedia().catch(()=>{});
  inFlight = (async()=>{const result=await pullOrders();await pushDesktopChanges();return result;})().finally(()=>{inFlight=null;});
  return inFlight;
}
async function pullOrders() {
  if(!isDesktop())throw new Error("Bu əməliyyat yalnız masaüstü tətbiqdə mümkündür.");
  const config = await readSyncConfig();
  if(!config)return {received:0};
  const sql = storeDb();
  let received = 0;
  try {
    // Cursor and rows commit together. Replaying a page is safe after a crash.
    const cursorKey = "desktop_cursor:"+hashKey(config.url);
    const [saved] = await sql.unsafe("select value from system_settings where key=$1",[cursorKey]);
    let cursor = saved?.value || "";
    for(let page=0;page<20;page++) {
      const data = await fetchOrderPage(config,cursor);
      if(!data.rows.length)break;
      await sql.begin(async tx=>{
        for(const order of data.rows) {
          const inserted = await tx.unsafe(`insert into desktop_order_inbox(store_url,remote_id,payload)
            values($1,$2,$3::text::jsonb) on conflict(store_url,remote_id) do nothing returning id`,[config.url,order.id,JSON.stringify(order)]);
          received += inserted.length;
          await tx.unsafe(`update desktop_order_inbox set payload=$3::text::jsonb,updated_at=now()
            where store_url=$1 and remote_id=$2 and payload is distinct from $3::text::jsonb`,[config.url,order.id,JSON.stringify(order)]);
          // A web-side closure must prevent a second payment for an unpaid local
          // copy. A paid local receipt is always retained for manual reconciliation.
          if(["cancelled","completed"].includes(order.status))await tx.unsafe(`update sales_orders set status='cancelled',updated_at=now(),
            note=case when $3='completed' then coalesce(note,'')||' · Vebdə tamamlanıb; yerli ödəniş bağlandı.' else note end
            where id=(select local_order_id from desktop_order_inbox where store_url=$1 and remote_id=$2)
            and status in ('pending','ready')`,[config.url,order.id,order.status]);
          if(order.status === "ready")await tx.unsafe(`update sales_orders set status='ready',updated_at=now()
            where id=(select local_order_id from desktop_order_inbox where store_url=$1 and remote_id=$2) and status='pending'`,[config.url,order.id]);
        }
        if(data.next)await tx.unsafe("insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value",[cursorKey,data.next]);
      });
      if(!data.next || data.next===cursor)break;
      cursor=data.next;
      if(data.rows.length<100)break;
    }
    return {received};
  } finally { await sql.end(); }
}
