import { createHash } from "node:crypto";
import { logSystemError } from "./lib/log-error";
import { NextResponse, type NextRequest } from "next/server";
import postgres from "postgres";

type Rule={prefix:string;read:string[];write:string[]};
const rules:Rule[]=[
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

export async function proxy(request:NextRequest){
  if(["/api/customer-account","/api/my-orders"].includes(request.nextUrl.pathname))return NextResponse.next();
  if(request.nextUrl.pathname==="/api/catalog"||request.nextUrl.pathname==="/api/customer-orders")return NextResponse.next();
  if(request.nextUrl.pathname.startsWith("/api/auth"))return NextResponse.next();
  const rule=rules.find(item=>request.nextUrl.pathname.startsWith(item.prefix));
  if(!rule)return NextResponse.json({error:"API marşrutu üçün icazə qaydası yoxdur"},{status:403});
  const token=request.cookies.get("birkassa_session")?.value;
  if(!token)return NextResponse.json({error:"Sistemə daxil olmaq lazımdır"},{status:401});
  if(!process.env.DATABASE_URL)return NextResponse.json({error:"Verilənlər bazası bağlantısı yoxdur"},{status:500});
  const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
  try{
    const tokenHash=createHash("sha256").update(token).digest("hex");
    const [session]=await sql.unsafe("select u.id,u.role from auth_sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.is_active=true",[tokenHash]);
    if(!session)return NextResponse.json({error:"Sessiyanın vaxtı bitib. Yenidən daxil olun"},{status:401});
    const roles=request.method==="GET"?rule.read:rule.write;
    if(!roles.includes(session.role))return NextResponse.json({error:"Bu əməliyyat üçün səlahiyyətiniz yoxdur"},{status:403});
    const headers=new Headers(request.headers);headers.set("x-birkassa-user-id",session.id);headers.set("x-birkassa-role",session.role);
    return NextResponse.next({request:{headers}});
  }catch(error){console.error("permission.proxy",error);void logSystemError("permission.proxy", error);return NextResponse.json({error:"İcazə yoxlanmadı"},{status:500})}finally{await sql.end({timeout:2})}
}

export const config={matcher:["/api/:path*"]};
