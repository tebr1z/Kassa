import {storeDb} from '@/lib/store-db';
import {isDesktop} from '@/lib/desktop-sync';
import {desktopAuthorization} from '@/lib/desktop-bridge';
import {readDesktopPublicProducts} from '@/lib/desktop-catalog-source';
import {desktopWebCatalogSchema,desktopWebCatalogByteLimit} from '@/lib/desktop-web-catalog';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// This is not a database export. The read projection and strict wire schema
// independently exclude quantities, costs, barcodes and authentication data.
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(isDesktop())return Response.json({error:'Not available'},{status:404,headers});
 const key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!/^bk_catalog_[a-f0-9]{64}$/.test(key))return Response.json({error:'Unauthorized'},{status:401,headers});
 const sql=storeDb();
 try{
  if(!await desktopAuthorization(sql,key,true))return Response.json({error:'Unauthorized'},{status:401,headers});
  const [size]=await sql.unsafe('select count(*)::int n from products');
  if(Number(size.n)>10000)return Response.json({error:'Catalogue exceeds desktop transfer limit'},{status:413,headers});
  const body=JSON.stringify(desktopWebCatalogSchema.parse({protocol:1,catalog:await readDesktopPublicProducts(sql)}));
  if(Buffer.byteLength(body)>desktopWebCatalogByteLimit)return Response.json({error:'Catalogue exceeds desktop transfer limit'},{status:413,headers});
  return new Response(body,{headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
 }catch{return Response.json({error:'Catalogue unavailable'},{status:503,headers});}
 finally{await sql.end({timeout:2}).catch(()=>{});}
}
