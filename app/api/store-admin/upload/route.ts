import {createHash} from "node:crypto";
import {cloudCredentials} from "@/lib/cloudinary-config";
import {storeDb} from "@/lib/store-db";
export const runtime="nodejs";
export async function POST(request:Request){
 if(Number(request.headers.get("content-length")||0)>6000000)return Response.json({error:"Şəkil maksimum 5 MB ola bilər"},{status:413});
 const form=await request.formData();const file=form.get("file"),productId=String(form.get("productId")||"");
 if(!(file instanceof File)||file.size>5000000||!["image/jpeg","image/png","image/webp"].includes(file.type))return Response.json({error:"JPG, PNG və ya WebP seçin (maksimum 5 MB)"},{status:400});
 if(productId&&!/^[0-9a-f-]{36}$/i.test(productId))return Response.json({error:"Məhsul düzgün deyil"},{status:400});
 const c=await cloudCredentials();if(!c.cloud||!c.key||!c.secret)return Response.json({error:"Əvvəlcə Cloudinary bağlantısını qurun"},{status:400});
 const sql=storeDb();
 try{
 if(productId){const [p]=await sql.unsafe("select id from products where id=$1",[productId]);if(!p)return Response.json({error:"Məhsul tapılmadı"},{status:404})}
 const timestamp=String(Math.floor(Date.now()/1000));const data=new FormData();data.set("file",file);data.set("timestamp",timestamp);data.set("api_key",c.key);data.set("signature",createHash("sha1").update("timestamp="+timestamp+c.secret).digest("hex"));
 const r=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(c.cloud)+"/image/upload",{method:"POST",body:data,signal:AbortSignal.timeout(30000)});
 const result=await r.json() as {secure_url?:string};if(!r.ok||!result.secure_url?.startsWith("https://res.cloudinary.com/"))return Response.json({error:"Cloudinary yükləməsi alınmadı. Açarları yoxlayın."},{status:502});
 if(productId)await sql.unsafe("update products set image_url=$1 where id=$2",[result.secure_url,productId]);else await sql.unsafe("update storefront_config set logo=$1 where id=1",[result.secure_url]);
 return Response.json({url:result.secure_url});
 }catch{return Response.json({error:"Şəkil yüklənmədi. Yenidən cəhd edin."},{status:502})}finally{await sql.end()}
}
