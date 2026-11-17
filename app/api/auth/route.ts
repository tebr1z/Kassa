import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {createHash} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
import {desktopAuthGet,desktopAuthPost,desktopActivity} from '@/lib/desktop-auth';
import {hasCentralDesktopAccess,centralDesktopDenied} from '@/lib/central-access';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return hasCentralDesktopAccess(request)?desktopAuthGet():centralDesktopDenied();}
export async function POST(request:Request){return hasCentralDesktopAccess(request)?desktopAuthPost(request):centralDesktopDenied();}
export async function PATCH(request:Request){return hasCentralDesktopAccess(request)?desktopActivity(request):centralDesktopDenied();}
export async function DELETE(request:Request){if(!hasCentralDesktopAccess(request))return centralDesktopDenied();const token=(await cookies()).get('birkassa_session')?.value,sql=storeDb();try{if(token)await sql.unsafe('delete from auth_sessions where token_hash=$1',[createHash('sha256').update(token).digest('hex')]);const response=NextResponse.json({ok:true});response.cookies.set('birkassa_session','',{httpOnly:true,sameSite:'strict',path:'/',expires:new Date(0)});return response;}finally{await sql.end();}}
