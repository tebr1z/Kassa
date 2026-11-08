import { createHash } from "node:crypto";
import { logSystemError } from "./lib/log-error";
import { NextResponse, type NextRequest } from "next/server";
import postgres from "postgres";
import {secureAdminRequest} from "./lib/admin-security";
import {canUseStaffApi,staffRoles} from './lib/staff-access';
import {STAFF_PORTAL_PATH,isStaffPortalPath,canOpenStaffPage} from './lib/staff-portal';

type Rule={prefix:string;read:string[];write:string[]};
const rules:Rule[]=[
  {prefix:'/api/admin/smtp',read:['admin'],write:['admin']},
  {prefix:'/api/admin/delivery',read:['admin'],write:['admin']},
  {prefix:'/api/locations',read:['admin'],write:['admin']},
  {prefix:"/api/desktop-media",read:["admin","manager","cashier","warehouse","accountant"],write:[]},
  {prefix:"/api/desktop-link",read:["admin"],write:["admin"]},
  {prefix:"/api/desktop-inbox",read:["admin","manager","cashier"],write:["admin","manager","cashier"]},
  {prefix:"/api/online-orders",read:["admin","manager","online_manager","online_assistant"],write:["admin","manager","online_manager","online_assistant"]},
  {prefix:"/api/store-admin",read:["admin"],write:["admin"]},
  {prefix:"/api/dashboard",read:["admin","manager","cashier","warehouse","accountant"],write:[]},
  {prefix:"/api/products",read:["admin","manager","cashier","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/warehouses",read:["admin","manager","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/stock",read:["admin","manager","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/inventory-counts",read:["admin","manager","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/purchase-orders",read:["admin","manager","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/suppliers",read:["admin","manager","warehouse","accountant"],write:["admin","manager","warehouse"]},
  {prefix:"/api/sales",read:["admin","manager","cashier"],write:["admin","manager","cashier"]},
  {prefix:"/api/shifts",read:["admin","manager","cashier"],write:["admin","manager","cashier"]},
  {prefix:"/api/orders",read:["admin","manager","cashier"],write:["admin","manager","cashier"]},
  {prefix:"/api/pos-options",read:["admin","manager","cashier"],write:["admin","manager","cashier"]},
  {prefix:"/api/returns",read:["admin","manager"],write:["admin","manager"]},
  {prefix:"/api/finance",read:["admin","manager","accountant"],write:["admin","manager","accountant"]},
  {prefix:"/api/reports",read:["admin","manager","accountant"],write:[]},
  {prefix:"/api/employees",read:["admin","manager"],write:["admin","manager"]},
  {prefix:"/api/settings",read:["admin"],write:["admin"]},
  {prefix:"/api/audit",read:["admin","manager"],write:[]},
  {prefix:"/api/categories",read:["admin","manager","cashier","warehouse"],write:["admin","manager","warehouse"]},
  {prefix:"/api/system",read:["admin","manager"],write:["admin"]},
  {prefix:"/api/client-errors",read:[],write:["admin","manager","cashier","warehouse","accountant"]},
];

function forward(request:NextRequest,user?:{id:string;role:string}){
 const headers=new Headers(request.headers);
 headers.delete("x-birkassa-user-id");headers.delete("x-birkassa-role");
 if(user){headers.set("x-birkassa-user-id",user.id);headers.set("x-birkassa-role",user.role);}
 const response=NextResponse.next({request:{headers}});
 response.headers.set("Cache-Control","private, no-store");
 if(!request.nextUrl.pathname.startsWith('/api/catalog-media/'))response.headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
 response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("X-Frame-Options","DENY");
 response.headers.set("Referrer-Policy","same-origin");
 response.headers.set("Content-Security-Policy","frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
 return response;
}
export async function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 // Do not reveal the unlisted replacement with a legacy redirect, even to a
 // signed-in user. The legacy page modules independently return notFound too.
 if(path==='/admin'||path.startsWith('/admin/'))return new NextResponse('Səhifə tapılmadı.',{status:404,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'}});
 // The legal document has its own public trailing-slash canonical, independent
 // of product URLs and the slashless staff/API policy below.
 if(path==='/istifadeci-sertleri'){
  const target=new URL(request.url);target.pathname='/istifadeci-sertleri/';
  return NextResponse.redirect(target,308);
 }
 if(path==='/istifadeci-sertleri/'){
  const headers=new Headers(request.headers);
  headers.delete('x-birkassa-user-id');headers.delete('x-birkassa-role');
  return NextResponse.next({request:{headers}});
 }
 const productDetail=/^\/(?:mehsullar|products)\/.+/.test(path);
 if(!productDetail&&path!=='/'&&path.endsWith('/')){
  const target=new URL(request.url);target.pathname=path.replace(/\/+$/,'');
  return NextResponse.redirect(target,308);
 }
 const publicPage=productDetail||['/mehsullar','/products','/account','/sizin-ucun'].includes(path)||path.startsWith('/categories/');
 if(publicPage){
  const headers=new Headers(request.headers);
  headers.delete('x-birkassa-user-id');headers.delete('x-birkassa-role');
  // Never trust a caller-supplied value. The page uses the real path to send
  // missing-slash and renamed-slug links directly to one canonical destination.
  headers.set('x-restamarket-product-pathname',path);
  return NextResponse.next({request:{headers}});
 }
 const adminPage=isStaffPortalPath(path);
 if(adminPage&&![STAFF_PORTAL_PATH,STAFF_PORTAL_PATH+'/store',STAFF_PORTAL_PATH+'/online'].includes(path))return new NextResponse('Səhifə tapılmadı.',{status:404,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive'}});
 if(adminPage&&!secureAdminRequest(request))return new NextResponse('İdarəetmə üçün HTTPS bağlantısı tələb olunur.',{status:426});
 if(path===STAFF_PORTAL_PATH)return forward(request);
 if(["/api/desktop-feed","/api/desktop-poll","/api/desktop-bridge","/api/desktop-image","/api/desktop-lock"].includes(request.nextUrl.pathname))return forward(request);
 if(request.nextUrl.pathname.startsWith('/api/desktop-media/'))return forward(request);
 if(request.nextUrl.pathname.startsWith('/api/catalog-media/'))return forward(request);
 if(!["GET","HEAD","OPTIONS"].includes(request.method)){
  const origin=request.headers.get("origin");
  const ownOrigin=request.nextUrl.protocol+"//"+request.headers.get("host");
  if(request.headers.get("sec-fetch-site")==="cross-site"||(origin&&origin!==ownOrigin)){
   return NextResponse.json({error:"Başqa saytdan göndərilən sorğu qəbul edilmir."},{status:403});
  }
 }
  if(["/api/customer-account","/api/my-orders","/api/contact","/api/coupon","/api/account-chat","/api/places"].includes(request.nextUrl.pathname))return forward(request);
  if(["/api/catalog","/api/customer-orders","/api/delivery-settings","/api/delivery-quote"].includes(request.nextUrl.pathname))return forward(request);
  if(request.nextUrl.pathname==="/api/auth")return secureAdminRequest(request)?forward(request):NextResponse.json({error:'Administrator girişi üçün HTTPS tələb olunur.'},{status:426});
  const rule=rules.find(item=>request.nextUrl.pathname===item.prefix||request.nextUrl.pathname.startsWith(item.prefix+"/"));
  if(!rule&&!adminPage)return NextResponse.json({error:"API marşrutu üçün icazə qaydası yoxdur"},{status:403});
  if(!secureAdminRequest(request))return NextResponse.json({error:'İdarəetmə üçün HTTPS tələb olunur.'},{status:426});
  const unauthenticated=()=>adminPage?NextResponse.redirect(new URL(STAFF_PORTAL_PATH,request.url)):NextResponse.json({error:'Sistemə şəxsi işçi şifrəsi ilə daxil olun.'},{status:401});
  const token=request.cookies.get("birkassa_session")?.value;
  if(!token)return unauthenticated();
  if(!process.env.DATABASE_URL)return NextResponse.json({error:"Verilənlər bazası bağlantısı yoxdur"},{status:500});
  const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
  try{
    const tokenHash=createHash("sha256").update(token).digest("hex");
    const [session]=await sql.unsafe("select u.id,u.role,s.authentication_method,s.last_seen_at>now()-interval '10 minutes' active from auth_sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.is_active=true and u.password_hash is not null",[tokenHash]);
    if(!session||!staffRoles.includes(session.role)||session.authentication_method!=='password'||!session.active)return unauthenticated();
    if(adminPage){if(!canOpenStaffPage(session.role,path))return NextResponse.redirect(new URL(STAFF_PORTAL_PATH,request.url));return forward(request,{id:session.id,role:session.role});}
    if(!adminPage&&!canUseStaffApi(session.role,path,request.method))return NextResponse.json({error:'Bu bölmə üçün səlahiyyətiniz yoxdur.'},{status:403});
    const roles=rule?(["GET","HEAD"].includes(request.method)?rule.read:rule.write):['admin'];
    if(!roles.includes(session.role))return NextResponse.json({error:"Bu əməliyyat üçün səlahiyyətiniz yoxdur"},{status:403});
    return forward(request,{id:session.id,role:session.role});
  }catch(error){console.error("permission.proxy",error);void logSystemError("permission.proxy", error);return NextResponse.json({error:"İcazə yoxlanmadı"},{status:500})}finally{await sql.end({timeout:2})}
}

// Matcher paths must be literals for Next.js build-time analysis.
export const config={matcher:["/api/:path*","/admin/:path*","/heyet-g7m4q9x2k8/:path*","/mehsullar/:path*","/products/:path*","/account/:path*","/categories/:path*","/sizin-ucun/:path*","/istifadeci-sertleri/:path*"]};
