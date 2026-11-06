import {publicImage} from '@/lib/catalog-media';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{hash:string}>}){
 const media=await publicImage((await params).hash);if(!media)return new Response(null,{status:404});
 return new Response(new Uint8Array(media.body),{headers:{'Content-Type':media.type,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'}});
}
