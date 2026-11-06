import {timingSafeEqual} from "node:crypto";
import {isDesktop,syncOrders} from "@/lib/desktop-sync";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Only the Electron main process knows this per-launch secret.
export async function POST(request:Request) {
  const expected=process.env.BIRKASSA_DESKTOP_TOKEN||"";
  const supplied=request.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  if(!isDesktop()||!expected||!/^[a-f0-9]{64}$/.test(supplied)||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return Response.json({error:"Unauthorized"},{status:401});
  try {return Response.json(await syncOrders());}
  catch {return Response.json({error:"Order connection unavailable"},{status:502});}
}
