import 'server-only';
import type postgres from 'postgres';
import {normalizeDesktopPublicProduct} from '@/lib/desktop-catalog-delta';

// An explicit public projection. Never select inventory, purchase prices,
// barcodes, finance or authentication fields into publication/baseline data.
export async function readDesktopPublicProducts(sql:Pick<ReturnType<typeof postgres>,'unsafe'>){
 const rows=await sql.unsafe(`select p.id,p.sku,p.name,p.public_code as "code",coalesce(p.category,'') as "category",p.unit,
  p.sale_price as "price",p.discount_price as "discountPrice",coalesce(p.description,'') as "description",coalesce(p.specifications,'') as "specifications",
  coalesce(p.image_url,'') as "image",(p.is_active and p.deleted_at is null) as "isActive",
  coalesce((select json_agg(pi.image_url order by position,id) from product_images as pi where pi.product_id=p.id),'[]'::json) as "images",
  coalesce((select json_agg(json_build_object('label',label,'size',size,'color',color,'kind',kind,'image',image_url,'attributes',attributes,'price',price,'position',position,'isActive',is_active) order by position,label) from product_options as po where po.product_id=p.id),'[]'::json) as "options"
  from products as p order by p.sku`);
 return rows.map(normalizeDesktopPublicProduct);
}
