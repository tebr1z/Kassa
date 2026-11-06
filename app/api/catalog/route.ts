import {getPublicCatalog} from '@/lib/public-catalog';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  return Response.json(await getPublicCatalog(),{headers:{'Cache-Control':'no-store','X-BirKassa-Inventory':'local-only'}});
 }catch(error){
  console.error('catalog.get',String((error as {code?:string}).code||'unavailable'));
  return Response.json({error:'Kataloq yüklənmədi. Yenidən cəhd edin.'},{status:503});
 }
}
