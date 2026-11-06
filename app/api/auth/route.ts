import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {createHash} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
import {desktopAuthGet,desktopAuthPost,desktopActivity} from '@/lib/desktop-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=desktopAuthGet;
export const POST=desktopAuthPost;
export const PATCH=desktopActivity;
export async function DELETE(){const token=(await cookies()).get('birkassa_session')?.value,sql=storeDb();try{if(token)await sql.unsafe('delete from auth_sessions where token_hash=$1',[createHash('sha256').update(token).digest('hex')]);const response=NextResponse.json({ok:true});response.cookies.set('birkassa_session','',{httpOnly:true,sameSite:'strict',path:'/',expires:new Date(0)});return response;}finally{await sql.end();}}
