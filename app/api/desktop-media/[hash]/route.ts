import {cachedMedia} from "@/lib/desktop-media";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{hash:string}>}) {
  if(process.env.BIRKASSA_LOCAL!=="1")return new Response(null,{status:404});
  const {hash}=await params,media=await cachedMedia(hash);
  if(!media)return new Response(null,{status:404});
  return new Response(new Uint8Array(media.body),{headers:{"Content-Type":media.type,"Cache-Control":"private, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"}});
}
