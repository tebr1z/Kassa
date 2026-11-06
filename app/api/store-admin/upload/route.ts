import {withAdminSession} from '@/lib/require-admin';
import {createHash} from "node:crypto";
import {cloudCredentials} from "@/lib/cloudinary-config";
import {storeDb} from "@/lib/store-db";
import {saveImage} from "@/lib/catalog-media";
export const runtime="nodejs";
async function acceptedImage(file:File,maxBytes:number){
 if(file.size<=0||file.size>maxBytes)return false;
 const type=file.type.toLowerCase();
 if(["image/jpeg","image/jpg","image/pjpeg","image/png","image/x-png","image/webp"].includes(type))return true;
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const jpeg=bytes[0]===0xff&&bytes[1]===0xd8;
 const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47;
 const webp=bytes[0]===0x52&&bytes[1]===0x49&&bytes[8]===0x57&&bytes[9]===0x45;
 return jpeg||png||webp;
}
async function handlePOST(request:Request){
 if(Number(request.headers.get("content-length")||0)>6000000)return Response.json({error:"Şəkil maksimum 5 MB ola bilər"},{status:413});
 const form=await request.formData();const file=form.get("file"),productId=String(form.get("productId")||""),categoryId=String(form.get("categoryId")||"");
 const maxBytes=productId?4000000:5000000;
 if(!(file instanceof File)||!(await acceptedImage(file,maxBytes)))return Response.json({error:productId?"Hər şəkil ən çoxu 4 MB ola bilər. JPG, PNG və ya WebP seçin.":"JPG, PNG və ya WebP seçin (maksimum 5 MB)"},{status:400});
 if(productId&&categoryId)return Response.json({error:"Şəkil bir hədəfə yüklənməlidir"},{status:400});
 if((productId||categoryId)&&!/^[0-9a-f-]{36}$/i.test(productId||categoryId))return Response.json({error:"Məlumat düzgün deyil"},{status:400});
 const local=process.env.BIRKASSA_LOCAL==="1";
 const c=await cloudCredentials();if(!local&&(!c.cloud||!c.key||!c.secret))return Response.json({error:"Əvvəlcə Cloudinary bağlantısını qurun"},{status:400});
 const sql=storeDb();
 try{
 if(productId){const [p]=await sql.unsafe("select id from products where id=$1",[productId]);if(!p)return Response.json({error:"Məhsul tapılmadı"},{status:404});const [count]=await sql.unsafe("select count(*)::int n from product_images where product_id=$1",[productId]);if(count.n>=8)return Response.json({error:"Bir məhsula ən çoxu 8 şəkil əlavə etmək olar."},{status:400});}
 if(categoryId){const [category]=await sql.unsafe("select id from product_categories where id=$1",[categoryId]);if(!category)return Response.json({error:"Kateqoriya tapılmadı"},{status:404})}
 let result:{secure_url?:string};
 if(local){result={secure_url:(await saveImage(Buffer.from(await file.arrayBuffer()),true)).url};}
 else{
 const timestamp=String(Math.floor(Date.now()/1000));const data=new FormData();data.set("file",file);data.set("timestamp",timestamp);data.set("api_key",c.key);data.set("signature",createHash("sha1").update("timestamp="+timestamp+c.secret).digest("hex"));
 const r=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(c.cloud)+"/image/upload",{method:"POST",body:data,signal:AbortSignal.timeout(30000)});
 result=await r.json() as {secure_url?:string};if(!r.ok||!result.secure_url?.startsWith("https://res.cloudinary.com/"))return Response.json({error:"Cloudinary yükləməsi alınmadı. Açarları yoxlayın."},{status:502});
 }
 if(!result.secure_url)return Response.json({error:"Şəkil saxlanmadı."},{status:502});
 if(categoryId)await sql.unsafe("update product_categories set image_url=$1 where id=$2",[result.secure_url,categoryId]);
 else if(productId){
  const [pos]=await sql.unsafe("select coalesce(max(position),-1)+1 as position from product_images where product_id=$1",[productId]);
  await sql.unsafe("insert into product_images(product_id,image_url,position) values($1,$2,$3)",[productId,result.secure_url,pos.position]);
  await sql.unsafe("update products set image_url=coalesce(nullif(image_url,''),$1) where id=$2",[result.secure_url,productId]);
 }else await sql.unsafe("update storefront_config set logo=$1 where id=1",[result.secure_url]);
 return Response.json({url:result.secure_url});
 }catch{return Response.json({error:"Şəkil yüklənmədi. Yenidən cəhd edin."},{status:502})}finally{await sql.end()}
}
async function handleDELETE(request:Request){
 const imageId=new URL(request.url).searchParams.get("imageId")||"";
 if(!/^[0-9a-f-]{36}$/i.test(imageId))return Response.json({error:"Şəkil düzgün deyil"},{status:400});
 const sql=storeDb();
 try{
  const [row]=await sql.unsafe("delete from product_images where id=$1 returning product_id,image_url",[imageId]);
  if(!row)return Response.json({error:"Şəkil tapılmadı"},{status:404});
  const [next]=await sql.unsafe("select image_url from product_images where product_id=$1 order by position,id limit 1",[row.product_id]);
  await sql.unsafe("update products set image_url=$1 where id=$2 and (image_url=$3 or image_url is null or btrim(image_url)='')",[next?.image_url||"",row.product_id,row.image_url]);
  return Response.json({ok:true});
 }catch{return Response.json({error:"Şəkil silinmədi."},{status:502})}finally{await sql.end()}
}

export const POST=withAdminSession(handlePOST);
export const DELETE=withAdminSession(handleDELETE);
